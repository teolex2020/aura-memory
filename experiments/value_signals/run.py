"""E41: what predicts the value of a memory? See PROTOCOL.md.

Run with the D:\\Aura-clean\\.venv interpreter (numpy) as a tool, with
llama-server (Qwen3-4B-Instruct-2507 Q8, -np 4) on 127.0.0.1:8091.
D2 (the owner's messages) never leaves this computer.
    python run.py sample     -> sample.json (D1 records)
    python run.py surprisal  -> cache/surprisal.jsonl
    python run.py judge      -> LLM judge on D1 (shared Gemini cache)
    python run.py analyze    -> results.json (aggregates only)
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import random
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SEED = 41
NEGATIVES = 1500
CONTEXT_CHARS = 1500
RECORD_CHARS = 600
SERVER = "http://127.0.0.1:8091/completion"
D2_DIR = HERE.parent / "real_conversations" / "data"

_spec = importlib.util.spec_from_file_location("e38", HERE.parent / "value_net" / "run.py")
e38 = importlib.util.module_from_spec(_spec)
sys.modules["e38"] = e38
_spec.loader.exec_module(e38)
e37 = e38.e37

(HERE / "cache").mkdir(exist_ok=True)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").split("\n") if l.strip()] if path.exists() else []

# ------------------------------------------------------------------ items


def d1_items() -> list[dict]:
    labels = {(r["conv"], r["id"]): r for r in
              read_jsonl(HERE.parent / "value_net" / "labels.jsonl")
              + read_jsonl(HERE.parent / "value_net_robustness" / "labels_extra.jsonl")}
    items = []
    for conv in e37.load():
        c = conv["conversation"]
        n = 1
        while f"session_{n}" in c:
            lines = []
            for t in c[f"session_{n}"]:
                text = t.get("text", "")
                lab = labels.get((conv["sample_id"], t["dia_id"]))
                if lab and text.strip():
                    items.append({"set": "D1", "key": f"{conv['sample_id']}/{t['dia_id']}", "group": conv["sample_id"],
                                  "context": "\n".join(lines)[-CONTEXT_CHARS:], "speaker": t["speaker"],
                                  "text": text, "consequence": lab["consequence"], "evidence": lab["evidence"]})
                lines.append(f"{t['speaker']}: {text}")
            n += 1
    return items


def sample() -> None:
    items = d1_items()
    pos = [i["key"] for i in items if i["consequence"] or i["evidence"]]
    neg = [i["key"] for i in items if not (i["consequence"] or i["evidence"])]
    keep = sorted(pos + random.Random(SEED).sample(neg, min(NEGATIVES, len(neg))))
    (HERE / "sample.json").write_text(json.dumps(keep))
    print(json.dumps({"positives": len(pos), "negatives": min(NEGATIVES, len(neg)), "total": len(keep)}))


def d1_sample() -> list[dict]:
    keep = set(json.loads((HERE / "sample.json").read_text()))
    return [i for i in d1_items() if i["key"] in keep]


def d2_items() -> list[dict]:
    msgs = read_jsonl(D2_DIR / "messages.jsonl")
    labels = {}
    for f in sorted((D2_DIR / "labels").glob("*.jsonl")):
        for r in read_jsonl(f):
            labels[r["id"]] = r
    restated = {r["restated_id"] for r in labels.values() if r.get("restates") and r.get("restated_id")}
    items, by_session = [], {}
    for m in sorted(msgs, key=lambda m: m["ts"]):
        prev = by_session.setdefault(m["session"], [])
        items.append({"set": "D2", "key": m["id"], "group": m["session"],
                      "context": "\n".join(f"User: {p}" for p in prev)[-CONTEXT_CHARS:], "speaker": "User",
                      "text": m["text"], "durable": bool(labels[m["id"]]["durable"]),
                      "restated_later": m["id"] in restated, "chars": m["chars"]})
        prev.append(m["text"])
    return items

# ------------------------------------------------------------------ surprisal

_lock = threading.Lock()
S_PATH = HERE / "cache" / "surprisal.jsonl"
_s_cache = {r["k"]: r for r in read_jsonl(S_PATH)}


def _escape(text: str) -> str:
    text = "".join(ch for ch in text if ch >= " " or ch in "\n\t")
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")


def surprisal_of(item: dict) -> dict:
    forced = " " + item["text"][:RECORD_CHARS].strip()
    prompt = (item["context"] + "\n" if item["context"] else "") + f"{item['speaker']}:"
    k = hashlib.sha256(json.dumps([prompt, forced]).encode()).hexdigest()
    if k in _s_cache:
        return _s_cache[k]
    body = {"prompt": prompt, "n_predict": 1024, "n_probs": 1, "temperature": 0,
            "grammar": f'root ::= "{_escape(forced)}"', "cache_prompt": False}
    req = urllib.request.Request(SERVER, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=900).read())
    lps = [p["logprob"] for p in r.get("completion_probabilities", [])]
    rec = {"k": k, "key": item["key"], "set": item["set"], "tokens": len(lps),
           "total": -sum(lps), "mean": -sum(lps) / max(1, len(lps)), "exact": r.get("content") == forced}
    with _lock:
        _s_cache[k] = rec
        with S_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    return rec


def surprisal() -> None:
    items = d1_sample() + d2_items()
    print(json.dumps({"items": len(items)}), flush=True)
    with ThreadPoolExecutor(4) as pool:
        for n, _ in enumerate(pool.map(surprisal_of, items), 1):
            if n % 250 == 0:
                print(json.dumps({"surprisal": n, "of": len(items)}), flush=True)

# ------------------------------------------------------------------ LLM judge (D1 only)

JUDGE = ("Message from a conversation:\n{speaker}: {text}\n\n"
         "Does this message state a decision, plan, preference, or fact about the speaker's life, work or "
         "situation that would matter later? Answer yes or no only.")


def judge_of(item: dict) -> bool:
    out = e37.gemini(None, JUDGE.format(speaker=item["speaker"], text=item["text"][:RECORD_CHARS]), 16)
    return out["text"].strip().lower().startswith("yes")


def judge() -> None:
    e37.BUDGET_USD = e37.spent() + 1.0
    items = d1_sample()
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(judge_of, items))
    print(json.dumps({"judged": len(items), "usd": round(e37.spent(), 3)}), flush=True)

# ------------------------------------------------------------------ analysis


def logit_cv(x: np.ndarray, y: np.ndarray, folds: list[np.ndarray]) -> float:
    """Pooled out-of-fold AUC of an L2 logistic regression (full-batch gradient descent)."""
    pred = np.zeros(len(y))
    for test in folds:
        train = np.setdiff1d(np.arange(len(y)), test)
        mu, sd = x[train].mean(0), x[train].std(0) + 1e-9
        z = (x - mu) / sd
        w, b = np.zeros(z.shape[1]), 0.0
        for _ in range(2000):
            p = 1 / (1 + np.exp(-(z[train] @ w + b)))
            g = p - y[train]
            w -= 0.1 * (z[train].T @ g / len(train) + 1e-3 * w)
            b -= 0.1 * g.mean()
        pred[test] = z[test] @ w + b
    return e38.auc(pred.tolist(), [bool(v) for v in y])


def folds_for(items: list[dict], by_group: bool) -> list[np.ndarray]:
    rng = random.Random(SEED)
    if by_group:
        groups = sorted({i["group"] for i in items})
        rng.shuffle(groups)
        parts = [groups[k::5] for k in range(5)]
        return [np.asarray([n for n, i in enumerate(items) if i["group"] in part]) for part in parts]
    idx = list(range(len(items)))
    rng.shuffle(idx)
    return [np.asarray(sorted(idx[k::5])) for k in range(5)]


def block(items: list[dict], label: str, by_group: bool, with_judge: bool) -> dict:
    s = [surprisal_of(i) for i in items]
    y = np.asarray([float(i[label]) for i in items])
    length = np.log1p([len(i["text"]) for i in items])
    mean = np.asarray([r["mean"] for r in s])
    total = np.asarray([r["total"] for r in s])
    truth = [bool(v) for v in y]
    folds = folds_for(items, by_group)
    out = {"n": len(items), "positives": int(y.sum()),
           "auc": {"length": e38.auc(length.tolist(), truth), "surprisal_mean": e38.auc(mean.tolist(), truth),
                   "surprisal_total": e38.auc(total.tolist(), truth)},
           "corr_surprisal_mean_vs_length": round(float(np.corrcoef(mean, length)[0, 1]), 3),
           "cv_auc": {"length": logit_cv(length[:, None], y, folds),
                      "length+surprisal_mean": logit_cv(np.c_[length, mean], y, folds)}}
    out["cv_gain_surprisal"] = round(out["cv_auc"]["length+surprisal_mean"] - out["cv_auc"]["length"], 3)
    if with_judge:
        j = np.asarray([float(judge_of(i)) for i in items])
        out["auc"]["llm_judge"] = e38.auc(j.tolist(), truth)
        out["cv_auc"]["length+llm_judge"] = logit_cv(np.c_[length, j], y, folds)
        out["cv_gain_llm_judge"] = round(out["cv_auc"]["length+llm_judge"] - out["cv_auc"]["length"], 3)
        out["llm_judge_yes_share"] = round(float(j.mean()), 3)
    out["forced_exact_share"] = round(sum(r["exact"] for r in s) / len(s), 3)
    return out


def analyze() -> None:
    d1, d2 = d1_sample(), d2_items()
    result = {
        "D1_consequence": block(d1, "consequence", True, True),
        "D1_evidence": block(d1, "evidence", True, True),
        "D2_durable": block(d2, "durable", False, False),
        "D2_restated_later": block(d2, "restated_later", False, False),
    }
    a, b = result["D1_consequence"], result["D2_durable"]
    result["gates"] = {"M1": a["cv_gain_surprisal"] >= 0.02 and b["cv_gain_surprisal"] >= 0.02,
                       "M2": a["auc"]["surprisal_mean"] >= 0.60 and b["auc"]["surprisal_mean"] >= 0.60}
    result["usd_total_shared_cache"] = round(e37.spent(), 3)
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"sample": sample, "surprisal": surprisal, "judge": judge, "analyze": analyze}[sys.argv[1]]()
