"""E38: can a micro network learn from consequences what is worth keeping? See PROTOCOL.md.

Run with the D:\\Aura-clean\\.venv interpreter (numpy) as a tool; reuses E37's
stream, retrieval, reader, judge and API cache.
    python run.py split    -> split.json
    python run.py label    -> labels.jsonl (consequence labels on training conversations)
    python run.py train    -> model.npz
    python run.py test     -> rows.jsonl
    python run.py analyze  -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import math
import random
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SEED = 38
HIDDEN = 64
EPOCHS = 300
LR = 1e-3
L2 = 1e-4
TEST_ARMS = ("U", "R", "D", "L", "V", "Vstar")

_spec = importlib.util.spec_from_file_location("e37", HERE.parent / "outcome_memory" / "run.py")
e37 = importlib.util.module_from_spec(_spec)
sys.modules["e37"] = e37
_spec.loader.exec_module(e37)

# ------------------------------------------------------------------ data


def raw_turns(conv: dict) -> dict[str, dict]:
    """Per dia_id: the stored text, the raw turn text and simple structure."""
    c = conv["conversation"]
    out = {}
    n = 1
    while f"session_{n}" in c:
        date = c.get(f"session_{n}_date_time", "")
        turns = c[f"session_{n}"]
        for k, t in enumerate(turns):
            out[t["dia_id"]] = {"text": e37.turn_text(t, date), "raw": t.get("text", ""),
                                "photo": bool(t.get("blip_caption")),
                                "position": k / max(1, len(turns) - 1), "session": n}
        n += 1
    return out


def evidence_of(q: dict, known: dict) -> list[str]:
    return [p for ev in q.get("evidence", []) for p in re.split(r"[;,\s]+", str(ev)) if p in known]


def split() -> None:
    ids = sorted(c["sample_id"] for c in e37.load())
    train = sorted(random.Random(SEED).sample(ids, 5))
    (HERE / "split.json").write_text(json.dumps({"train": train, "test": [i for i in ids if i not in train]}, indent=1))


def the_split() -> dict:
    return json.loads((HERE / "split.json").read_text())

# ------------------------------------------------------------------ consequence labels


def label_conv(conv: dict) -> list[dict]:
    turns = raw_turns(conv)
    questions = []
    for i, q in enumerate(conv["qa"]):
        ev = evidence_of(q, turns)
        if q.get("category") in (1, 2, 3, 4) and ev:
            questions.append({"qid": f"{conv['sample_id']}-{i}", "question": q["question"],
                              "answer": str(q.get("answer", "")), "category": q["category"],
                              "after": max(turns[e]["session"] for e in ev)})
    questions.sort(key=lambda q: q["after"])
    dates = {turns[d]["session"]: conv["conversation"].get(f"session_{turns[d]['session']}_date_time", "")
             for d in turns}
    positive: set[str] = set()
    for q in questions:
        stored = [(d, t) for d, t in turns.items() if t["session"] <= q["after"]]
        qv = e37.vec(q["question"])
        top = sorted(stored, key=lambda dt: -e37.dot(e37.vec(dt[1]["text"]), qv))[:e37.TOP_K]
        texts = [t["text"] for _, t in top]
        answer, used = e37.read(q, dates[q["after"]], texts)
        if not e37.judge(q, answer):
            continue
        for n in [u for u in dict.fromkeys(used) if 1 <= u <= len(top)][:e37.MAX_CREDIT_TESTS]:
            if not e37.judge(q, e37.read(q, dates[q["after"]], texts[:n - 1] + texts[n:])[0]):
                positive.add(top[n - 1][0])
    evidence = {e for q in conv["qa"] if q.get("category") in (1, 2, 3, 4) for e in evidence_of(q, turns)}
    return [{"conv": conv["sample_id"], "id": d, "consequence": d in positive, "evidence": d in evidence}
            for d in turns]


def label() -> None:
    convs = {c["sample_id"]: c for c in e37.load()}
    out = HERE / "labels.jsonl"
    done = {json.loads(l)["conv"] for l in out.read_text(encoding="utf-8").split("\n") if l.strip()} \
        if out.exists() else set()
    lock = threading.Lock()

    def one(cid):
        rows = label_conv(convs[cid])
        with lock, out.open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"conv": cid, "records": len(rows), "consequence": sum(r["consequence"] for r in rows),
                          "evidence": sum(r["evidence"] for r in rows), "usd": round(e37.spent(), 3)}), flush=True)

    with ThreadPoolExecutor(5) as pool:
        list(pool.map(one, [c for c in the_split()["train"] if c not in done]))

# ------------------------------------------------------------------ network


def features(turn: dict) -> np.ndarray:
    raw = turn["raw"]
    digits = sum(ch.isdigit() for ch in raw) / max(1, len(raw))
    extra = [math.log1p(len(raw)), digits, float(turn["photo"]), turn["position"]]
    return np.concatenate([np.asarray(e37.vec(turn["text"]), dtype=np.float32), np.asarray(extra, dtype=np.float32)])


def matrix(conv_ids: list[str]) -> tuple[np.ndarray, list[tuple[str, str]]]:
    convs = {c["sample_id"]: c for c in e37.load()}
    xs, keys = [], []
    for cid in conv_ids:
        for d, t in raw_turns(convs[cid]).items():
            xs.append(features(t))
            keys.append((cid, d))
    return np.stack(xs), keys


def fit(x: np.ndarray, y: np.ndarray) -> dict:
    rng = np.random.default_rng(SEED)
    mu, sd = x.mean(0), x.std(0) + 1e-6
    z = (x - mu) / sd
    w1 = rng.normal(0, math.sqrt(2 / z.shape[1]), (z.shape[1], HIDDEN)).astype(np.float32)
    b1 = np.zeros(HIDDEN, np.float32)
    w2 = rng.normal(0, math.sqrt(1 / HIDDEN), (HIDDEN, 1)).astype(np.float32)
    b2 = np.zeros(1, np.float32)
    pos = max(1.0, y.sum())
    weight = np.where(y > 0, len(y) / (2 * pos), len(y) / (2 * max(1.0, len(y) - pos))).astype(np.float32)
    params = [w1, b1, w2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    for step in range(1, EPOCHS + 1):
        h = np.maximum(z @ w1 + b1, 0)
        p = 1 / (1 + np.exp(-(h @ w2 + b2)[:, 0]))
        g = (weight * (p - y) / len(y))[:, None]
        gw2 = h.T @ g + L2 * w2
        gb2 = g.sum(0)
        gh = (g @ w2.T) * (h > 0)
        gw1 = z.T @ gh + L2 * w1
        gb1 = gh.sum(0)
        for i, gr in enumerate((gw1, gb1, gw2, gb2)):
            m[i] = 0.9 * m[i] + 0.1 * gr
            v[i] = 0.999 * v[i] + 0.001 * gr * gr
            params[i] -= LR * (m[i] / (1 - 0.9 ** step)) / (np.sqrt(v[i] / (1 - 0.999 ** step)) + 1e-8)
    return {"mu": mu, "sd": sd, "w1": w1, "b1": b1, "w2": w2, "b2": b2}


def predict(model: dict, x: np.ndarray) -> np.ndarray:
    z = (x - model["mu"]) / model["sd"]
    h = np.maximum(z @ model["w1"] + model["b1"], 0)
    return 1 / (1 + np.exp(-(h @ model["w2"] + model["b2"])[:, 0]))


def train() -> None:
    labels = {(r["conv"], r["id"]): r for r in
              (json.loads(l) for l in (HERE / "labels.jsonl").read_text(encoding="utf-8").split("\n") if l.strip())}
    x, keys = matrix(the_split()["train"])
    for name, field in (("V", "consequence"), ("Vstar", "evidence")):
        y = np.asarray([float(labels[k][field]) for k in keys], np.float32)
        model = fit(x, y)
        np.savez(HERE / f"model_{name}.npz", **model)
        print(json.dumps({"model": name, "records": len(y), "positives": int(y.sum())}), flush=True)


def load_model(name: str) -> dict:
    data = np.load(HERE / f"model_{name}.npz")
    return {k: data[k] for k in data.files}

# ------------------------------------------------------------------ test stream


def run_test_conv(conv: dict, raw: dict, arm: str, values: dict[str, float]) -> list[dict]:
    store: dict[str, dict] = {}
    by_after: dict[int, list[dict]] = {}
    for q in conv["questions"]:
        by_after.setdefault(q["after"], []).append(q)
    rows = []
    for s in conv["sessions"]:
        t = s["index"]
        for turn in s["turns"]:
            store[turn["id"]] = {"id": turn["id"], "text": turn["text"], "t_created": t, "t_last": t,
                                 "accesses": 0, "credits": 0, "v": e37.vec(turn["text"])}
        if arm != "U" and len(store) > conv["capacity"]:
            def score(r):
                if arm in ("R", "D"):
                    return e37.score(arm, r, t)
                if arm == "L":
                    return len(raw[r["id"]]["raw"])
                return values[r["id"]]
            ranked = sorted(store.values(), key=lambda r: (score(r), r["t_created"]))
            for r in ranked[:len(store) - conv["capacity"]]:
                del store[r["id"]]
        for q in by_after.get(t, []):
            qv = e37.vec(q["question"])
            top = sorted(store.values(), key=lambda r: -e37.dot(r["v"], qv))[:e37.TOP_K]
            for r in top:
                r["accesses"] += 1
                r["t_last"] = t
            answer, _ = e37.read(q, s["date"], [r["text"] for r in top])
            rows.append({"conv": conv["id"], "arm": arm, "qid": q["qid"], "category": q["category"],
                         "correct": e37.judge(q, answer),
                         "evidence_kept": sum(e in store for e in q["evidence"]) / len(q["evidence"])})
    return rows


def test() -> None:
    test_ids = the_split()["test"]
    data = {c["sample_id"]: c for c in e37.load()}
    convs = [e37.build(data[cid]) for cid in test_ids]
    raws = {cid: raw_turns(data[cid]) for cid in test_ids}
    x, keys = matrix(test_ids)
    values = {}
    for name in ("V", "Vstar"):
        p = predict(load_model(name), x)
        values[name] = {cid: {} for cid in test_ids}
        for (cid, d), val in zip(keys, p):
            values[name][cid][d] = float(val)
    out = HERE / "rows.jsonl"
    done = set()
    if out.exists():
        for l in out.read_text(encoding="utf-8").split("\n"):
            if l.strip():
                r = json.loads(l)
                done.add((r["conv"], r["arm"]))
    lock = threading.Lock()

    def one(job):
        conv, arm = job
        rows = run_test_conv(conv, raws[conv["id"]], arm, values.get(arm, {}).get(conv["id"], {}))
        with lock, out.open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"conv": conv["id"], "arm": arm,
                          "acc": round(100 * sum(r["correct"] for r in rows) / len(rows), 1),
                          "usd": round(e37.spent(), 3)}), flush=True)

    jobs = [(c, a) for c in convs for a in TEST_ARMS if (c["id"], a) not in done]
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one, jobs))

# ------------------------------------------------------------------ analysis


def auc(scores: list[float], labels: list[bool]) -> float:
    pos = [s for s, l in zip(scores, labels) if l]
    neg = [s for s, l in zip(scores, labels) if not l]
    order = sorted((s, i) for i, s in enumerate(pos + neg))
    ranks = [0.0] * len(order)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and order[j + 1][0] == order[i][0]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k][1]] = (i + j) / 2 + 1
        i = j + 1
    r_pos = sum(ranks[:len(pos)])
    return round((r_pos - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)), 3)


def analyze() -> None:
    rows = [json.loads(l) for l in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]

    def pct(xs):
        xs = list(xs)
        return round(100 * sum(xs) / len(xs), 1) if xs else None

    acc = {a: pct(r["correct"] for r in rows if r["arm"] == a) for a in TEST_ARMS}
    by_cat = {c: {a: pct(r["correct"] for r in rows if r["arm"] == a and r["category"] == c) for a in TEST_ARMS}
              for c in (1, 2, 3, 4)}
    kept = {a: round(100 * sum(r["evidence_kept"] for r in rows if r["arm"] == a)
                     / max(1, sum(r["arm"] == a for r in rows)), 1) for a in TEST_ARMS}
    test_ids = the_split()["test"]
    data = {c["sample_id"]: c for c in e37.load()}
    x, keys = matrix(test_ids)
    ev = set()
    for cid in test_ids:
        turns = raw_turns(data[cid])
        ev |= {(cid, e) for q in data[cid]["qa"] if q.get("category") in (1, 2, 3, 4) for e in evidence_of(q, turns)}
    truth = [k in ev for k in keys]
    aucs = {name: auc(predict(load_model(name), x).tolist(), truth) for name in ("V", "Vstar")}
    lengths = [len(raw_turns(data[cid])[d]["raw"]) for cid, d in keys]
    aucs["L"] = auc([float(v) for v in lengths], truth)
    labels = [json.loads(l) for l in (HERE / "labels.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    gates = {"H0": acc["U"] >= acc["R"] + 10, "H1": acc["V"] >= acc["D"] + 5, "H2": acc["V"] >= acc["L"] + 3}
    result = {"questions": len(rows) // len(TEST_ARMS), "gates": gates, "accuracy": acc, "by_category": by_cat,
              "evidence_kept_percent": kept, "auc_evidence_on_test_records": aucs,
              "training_labels": {"records": len(labels), "consequence": sum(r["consequence"] for r in labels),
                                  "evidence": sum(r["evidence"] for r in labels)},
              "usd_total_shared_cache": round(e37.spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"split": split, "label": label, "train": train, "test": test, "analyze": analyze}[sys.argv[1]]()
