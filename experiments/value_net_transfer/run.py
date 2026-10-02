"""E40: does the value net transfer from LoCoMo to LongMemEval? See PROTOCOL.md.

Run with the D:\\Aura-clean\\.venv interpreter (numpy) as a tool; reuses E38's
network code and labels, E39's extra labels, E37's reader, judge prompts and
API cache.
    python run.py embed    -> cache/embeddings.sqlite (prefixed records, bge-m3)
    python run.py run      -> rows.jsonl
    python run.py analyze  -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import random
import sqlite3
import statistics
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA = Path(r"D:\Aura-clean\target\aura-local\external-benchmarks\longmemeval\longmemeval_s.json")
DATA_SHA256 = "08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894"
PER_TYPE, SAMPLE_SEED = 20, 19
CAPACITY_SHARE = 0.25
TOP_K = 10
TRAIN_SEED = 38
ARMS = ("U", "R", "D", "L", "V", "S")
OWN_BUDGET_USD = 3.0

_spec = importlib.util.spec_from_file_location("e38", HERE.parent / "value_net" / "run.py")
e38 = importlib.util.module_from_spec(_spec)
sys.modules["e38"] = e38
_spec.loader.exec_module(e38)
e37 = e38.e37
e37.BUDGET_USD = e37.spent() + OWN_BUDGET_USD  # E40's own cap on top of what is already spent

(HERE / "cache").mkdir(exist_ok=True)

# ------------------------------------------------------------------ data


def questions() -> list[dict]:
    digest = hashlib.sha256(DATA.read_bytes()).hexdigest()
    if digest != DATA_SHA256:
        raise SystemExit(f"LongMemEval hash mismatch: {digest}")
    data = json.loads(DATA.read_text(encoding="utf-8"))
    pool = [q for q in data if not q["question_id"].endswith("_abs")]
    rng = random.Random(SAMPLE_SEED)
    out = []
    for qtype in sorted({q["question_type"] for q in pool}):
        out += rng.sample([q for q in pool if q["question_type"] == qtype], PER_TYPE)
    return out


def records(q: dict) -> list[dict]:
    out = []
    for k, (date, session) in enumerate(zip(q["haystack_dates"], q["haystack_sessions"])):
        turns = [t for t in session if t["content"].strip()]
        for j, t in enumerate(turns):
            role = "User" if t["role"] == "user" else "Assistant"
            out.append({"id": f"{k}:{j}", "session": k, "text": f"[{date}] {role}: {t['content']}",
                        "raw": t["content"], "photo": False, "position": j / max(1, len(turns) - 1),
                        "evidence": bool(t.get("has_answer")), "assistant": role == "Assistant"})
    return out

# ------------------------------------------------------------------ embeddings

_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")
_db_lock = threading.Lock()


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _ollama(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["embeddings"]


def _unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    return v / (np.linalg.norm(v) or 1.0)


def embed() -> None:
    texts = sorted({r["text"] for q in questions() for r in records(q)} | {q["question"] for q in questions()})
    todo = [t for t in texts if not _db.execute("SELECT 1 FROM emb WHERE h=?", (_key(t),)).fetchone()]
    for i in range(0, len(todo), 32):
        chunk = todo[i:i + 32]
        try:
            vecs = _ollama(chunk)
        except Exception:  # a rejected batch is embedded text by text (cut if needed), as in E19 D2
            vecs = []
            for t in chunk:
                for cut in (None, 8000, 2000):
                    try:
                        vecs.append(_ollama([t if cut is None else t[:cut]])[0])
                        break
                    except Exception:
                        continue
                else:
                    raise
        _db.executemany("INSERT OR REPLACE INTO emb VALUES (?, ?)",
                        [(_key(t), _unit(v).tobytes()) for t, v in zip(chunk, vecs)])
        _db.commit()
        if (i // 32) % 50 == 0:
            print(json.dumps({"embedded": i + len(chunk), "of": len(todo)}), flush=True)
    print(json.dumps({"embedded_total": len(todo)}), flush=True)


def vec(text: str) -> np.ndarray:
    with _db_lock:
        row = _db.execute("SELECT v FROM emb WHERE h=?", (_key(text),)).fetchone()
    if row is None:
        raise RuntimeError("missing embedding; run `embed` first")
    return np.frombuffer(row[0], dtype=np.float32)

# ------------------------------------------------------------------ models


def all_labels() -> dict:
    rows = []
    for path in (HERE.parent / "value_net" / "labels.jsonl", HERE.parent / "value_net_robustness" / "labels_extra.jsonl"):
        rows += [json.loads(l) for l in path.read_text(encoding="utf-8").split("\n") if l.strip()]
    return {(r["conv"], r["id"]): r for r in rows}


def train_models() -> dict[str, dict]:
    lab = all_labels()
    convs = sorted({c for c, _ in lab})
    assert len(convs) == 10, "E40 trains on all 10 LoCoMo conversations"
    x, keys = e38.matrix(convs)
    y = np.asarray([float(lab[k]["consequence"]) for k in keys], np.float32)
    e38.SEED = TRAIN_SEED
    return {"V": e38.fit(x, y), "S": e38.fit(x[:, -4:], y)}


def features(r: dict) -> np.ndarray:
    raw = r["raw"]
    digits = sum(ch.isdigit() for ch in raw) / max(1, len(raw))
    extra = [math.log1p(len(raw)), digits, 0.0, r["position"]]
    return np.concatenate([vec(r["text"]), np.asarray(extra, dtype=np.float32)])

# ------------------------------------------------------------------ run


def judge(q: dict, answer: str) -> bool:
    prompt = e37.get_anscheck_prompt(q["question_type"], q["question"], str(q["answer"]), answer)
    return e37.gemini(None, prompt, 16)["text"].strip().lower().startswith("yes")


def run_question(q: dict, models: dict) -> list[dict]:
    recs = records(q)
    capacity = round(CAPACITY_SHARE * len(recs))
    x = np.stack([features(r) for r in recs])
    values = {"V": e38.predict(models["V"], x), "S": e38.predict(models["S"], x[:, -4:]),
              "L": np.asarray([len(r["raw"]) for r in recs], dtype=np.float32)}
    rows = []
    for arm in ARMS:
        kept: list[int] = []
        last_session = max(r["session"] for r in recs)
        for s in range(last_session + 1):
            kept += [i for i, r in enumerate(recs) if r["session"] == s]
            if arm != "U" and len(kept) > capacity:
                if arm in ("R", "D"):  # no accesses before the final question: decay = recency
                    key = lambda i: (recs[i]["session"], i)
                else:
                    key = lambda i: (float(values[arm][i]), recs[i]["session"])
                kept = sorted(kept, key=key)[len(kept) - capacity:]
        qv = vec(q["question"])
        sims = np.stack([vec(recs[i]["text"]) for i in kept]) @ qv
        top = [kept[i] for i in np.argsort(-sims)[:TOP_K]]
        answer, _ = e37.read({"question": q["question"]}, q["question_date"], [recs[i]["text"] for i in top])
        ev = [i for i, r in enumerate(recs) if r["evidence"]]
        kept_set = set(kept)
        rows.append({"qid": q["question_id"], "type": q["question_type"], "arm": arm,
                     "correct": judge(q, answer),
                     "evidence_kept": (sum(i in kept_set for i in ev) / len(ev)) if ev else None,
                     "assistant_share_kept": sum(recs[i]["assistant"] for i in kept) / len(kept)})
    return rows


def run() -> None:
    out = HERE / "rows.jsonl"
    done = {json.loads(l)["qid"] for l in out.read_text(encoding="utf-8").split("\n") if l.strip()} \
        if out.exists() else set()
    models = train_models()
    lock = threading.Lock()

    def one(q):
        rows = run_question(q, models)
        with lock, out.open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"q": q["question_id"], **{r["arm"]: r["correct"] for r in rows},
                          "usd": round(e37.spent(), 3)}), flush=True)

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one, [q for q in questions() if q["question_id"] not in done]))


def analyze() -> None:
    rows = [json.loads(l) for l in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]

    def pct(xs):
        xs = [x for x in xs if x is not None]
        return round(100 * sum(xs) / len(xs), 1) if xs else None

    acc = {a: pct(r["correct"] for r in rows if r["arm"] == a) for a in ARMS}
    by_type = {t: {a: pct(r["correct"] for r in rows if r["arm"] == a and r["type"] == t) for a in ARMS}
               for t in sorted({r["type"] for r in rows})}
    kept = {a: pct(r["evidence_kept"] for r in rows if r["arm"] == a) for a in ARMS}
    assistant = {a: pct(r["assistant_share_kept"] for r in rows if r["arm"] == a) for a in ARMS}
    gates = {"T0": acc["U"] >= acc["R"] + 10, "T1": acc["V"] >= acc["D"] + 5, "T2": acc["V"] >= acc["L"] + 3}
    result = {"questions": len(rows) // len(ARMS), "gates": gates, "accuracy": acc, "by_type": by_type,
              "evidence_kept_percent": kept, "assistant_share_of_kept_percent": assistant,
              "usd_total_shared_cache": round(e37.spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"embed": embed, "run": run, "analyze": analyze}[sys.argv[1]]()
