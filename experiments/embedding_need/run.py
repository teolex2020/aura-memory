"""E31: does Aura need semantic embeddings? EMB (bge-m3) vs LEX (none).

See PROTOCOL.md. Run in the mem0 venv with the current core on PYTHONPATH:
    python run.py d1        -> results/d1.jsonl  (LongMemEval-S, E19 selection)
    python run.py d2        -> results/d2.jsonl  (E22b personas)
    python run.py analyze   -> results/summary.json
"""

from __future__ import annotations

import importlib.util
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
OUT.mkdir(exist_ok=True)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# E19 brings the LongMemEval selection, the judge and the cached bge-m3.
e19 = _load("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
from aura import Aura, Level  # noqa: E402

ARMS = ("EMB", "LEX")


def store_d1(ts: list[dict], root: Path, arm: str) -> Aura:
    brain = Aura(str(root))
    if arm == "EMB":
        brain.set_embedding_fn(e19.embed)
    for t in ts:  # E19 capture mode (A-cap)
        channel = "user-claude-code" if t["role"] == "user" else "agent-claude-code"
        brain.store(t["content"], level=Level.Domain, channel=channel, deduplicate=False)
    return brain


def d1() -> None:
    out = OUT / "d1.jsonl"
    done = {json.loads(l)["qid"] for l in out.read_text(encoding="utf-8").splitlines()} if out.exists() else set()
    questions = e19.select(e19.load(), "sample")
    with out.open("a", encoding="utf-8") as f:
        for n, q in enumerate(questions, 1):
            if q["question_id"] in done:
                continue
            ts = e19.turns(q)
            row = {"qid": q["question_id"], "type": q["question_type"]}
            for arm in ARMS:
                with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                    brain = store_d1(ts, Path(d) / "aura", arm)
                    try:
                        start = time.perf_counter()
                        hits = brain.recall_structured(q["question"], top_k=e19.TOP_K)
                        ms = (time.perf_counter() - start) * 1000
                    finally:
                        brain.close()
                ranked = [h["content"] for h in hits]
                row[arm] = {**e19.judge(ranked, ts, set(q["answer_session_ids"])), "query_ms": round(ms, 1)}
            f.write(json.dumps(row) + "\n")
            f.flush()
            print(n, row["qid"], {a: row[a]["turn_any@10"] for a in ARMS}, flush=True)


# ------------------------------------------------------------------ D2


def store_d2(persona: dict, directory: str, arm: str) -> Aura:
    """E22b's build_store, with or without the embedding function."""
    brain = Aura(directory)
    if arm == "EMB":
        brain.set_embedding_fn(e19.embed)
    for i, text in enumerate(persona["ordinary"]):
        brain.store(text, level=Level.Working if i % 2 else Level.Domain,
                    source_type="recorded", deduplicate=False)
    for item in persona["untrusted"]:
        brain.store(item["text"], level=Level.Identity, source_type="retrieved",
                    metadata={"channel": item["channel"]}, deduplicate=False)
    for text in persona["identity"]:
        brain.store(text, level=Level.Identity, source_type="recorded", deduplicate=False)
    return brain


def needed_in(context: str, q: dict) -> bool:
    if q["type"] == "inference":
        return q["identity_marker"] in context
    return any(x in context for x in q["expected_any"])


def d2() -> None:
    path = HERE.parent / "identity_block" / "data" / "personas.jsonl"
    personas = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = []
    for persona in personas:
        per_arm = {}
        for arm in ARMS:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                brain = store_d2(persona, d, arm)
                try:
                    results = []
                    for q in persona["questions"]:
                        start = time.perf_counter()
                        context = brain.recall(q["question"])
                        ms = (time.perf_counter() - start) * 1000
                        results.append((needed_in(context, q), round(ms, 1)))
                finally:
                    brain.close()
            per_arm[arm] = results
        for i, q in enumerate(persona["questions"]):
            rows.append({"qid": q["id"], "lang": persona["lang"], "type": q["type"],
                         **{arm: {"present": per_arm[arm][i][0], "query_ms": per_arm[arm][i][1]} for arm in ARMS}})
        print(persona["id"], {arm: sum(p for p, _ in per_arm[arm]) for arm in ARMS}, flush=True)
    (OUT / "d2.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                                  encoding="utf-8")


# ------------------------------------------------------------------ analysis


def pct(xs) -> float:
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else 0.0


def analyze() -> None:
    summary = {}
    d1_rows = [json.loads(l) for l in (OUT / "d1.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    summary["d1"] = {
        "n": len(d1_rows),
        **{arm: {
            "turn_any@10": pct(r[arm]["turn_any@10"] for r in d1_rows),
            "turn_any@5": pct(r[arm]["turn_any@5"] for r in d1_rows),
            "ndcg@10": round(statistics.mean(r[arm]["ndcg@10"] for r in d1_rows), 3),
            "query_ms_median": statistics.median(r[arm]["query_ms"] for r in d1_rows),
        } for arm in ARMS},
        "by_type": {t: {arm: pct(r[arm]["turn_any@10"] for r in d1_rows if r["type"] == t) for arm in ARMS}
                    for t in sorted({r["type"] for r in d1_rows})},
    }
    summary["d1"]["delta_pp"] = round(summary["d1"]["EMB"]["turn_any@10"] - summary["d1"]["LEX"]["turn_any@10"], 1)
    d2_rows = [json.loads(l) for l in (OUT / "d2.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    summary["d2"] = {
        "n": len(d2_rows),
        **{arm: {"present": pct(r[arm]["present"] for r in d2_rows),
                 "query_ms_median": statistics.median(r[arm]["query_ms"] for r in d2_rows)} for arm in ARMS},
        "by_lang_type": {f"{lang}/{t}": {arm: pct(r[arm]["present"] for r in d2_rows
                                               if r["lang"] == lang and r["type"] == t) for arm in ARMS}
                         for lang in ("uk", "en") for t in sorted({r["type"] for r in d2_rows})},
    }
    summary["d2"]["delta_pp"] = round(summary["d2"]["EMB"]["present"] - summary["d2"]["LEX"]["present"], 1)
    deltas = (summary["d1"]["delta_pp"], summary["d2"]["delta_pp"])
    summary["decision"] = ("radical" if max(deltas) >= 10 else "small" if max(deltas) < 5 else "in_between")
    summary["lex_misses_emb_finds"] = {
        "d1": [r["qid"] for r in d1_rows if r["EMB"]["turn_any@10"] and not r["LEX"]["turn_any@10"]][:10],
        "d2": [r["qid"] for r in d2_rows if r["EMB"]["present"] and not r["LEX"]["present"]][:10],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    {"d1": d1, "d2": d2, "analyze": analyze}[sys.argv[1]]()
