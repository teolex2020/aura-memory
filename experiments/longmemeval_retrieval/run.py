"""E19: LongMemEval retrieval, Aura capture vs mem0. See PROTOCOL.md.

Run in the mem0 venv with the E18 Aura package on PYTHONPATH:
    python run.py embed [sample|full]   -> embeds every turn and question (cache/embeddings.sqlite)
    python run.py run [sample|full]     -> rows_<set>.jsonl (resumable)
    python run.py analyze [sample|full] -> results_<set>.json
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sqlite3
import statistics
import sys
import tempfile
import time
import urllib.error
import urllib.request
from array import array
from pathlib import Path

os.environ["MEM0_TELEMETRY"] = "False"

from mem0 import Memory  # noqa: E402
from mem0.configs.llms.base import BaseLlmConfig  # noqa: E402
from mem0.embeddings.base import EmbeddingBase  # noqa: E402
from mem0.llms.base import LLMBase  # noqa: E402
from mem0.utils.factory import EmbedderFactory, LlmFactory  # noqa: E402

from aura import Aura, Level  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = Path(r"D:\Aura-clean\target\aura-local\external-benchmarks\longmemeval\longmemeval_s.json")
DATA_SHA256 = "08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894"
OLLAMA = "http://127.0.0.1:11434"
DIMS = 1024
PER_TYPE = 20
SEED = 19
TOP_K = 10
ARMS = ("M", "A-cap", "A-flat")

# ------------------------------------------------------------------ embeddings

(HERE / "cache").mkdir(exist_ok=True)
_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite")
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _ollama(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as response:
        return json.loads(response.read())["embeddings"]


FALLBACKS: list[dict] = []


def _ollama_safe(texts: list[str]) -> list[list[float]]:
    """Amendment D2: a batch that Ollama rejects is embedded text by text; a text it
    rejects alone is retried on its first 8,000 and then 2,000 characters (logged)."""
    try:
        return _ollama(texts)
    except urllib.error.HTTPError:
        if len(texts) > 1:
            return [_ollama_safe([t])[0] for t in texts]
    for cut in (8000, 2000):
        try:
            vec = _ollama([texts[0][:cut]])[0]
            FALLBACKS.append({"sha1": _key(texts[0]), "chars": len(texts[0]), "cut": cut})
            with (HERE / "cache" / "fallbacks.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(FALLBACKS[-1]) + "\n")
            return [vec]
        except urllib.error.HTTPError:
            continue
    raise RuntimeError(f"cannot embed text of {len(texts[0])} characters")


def embed(text: str) -> list[float]:
    row = _db.execute("SELECT v FROM emb WHERE h=?", (_key(text),)).fetchone()
    if row:
        return array("f", row[0]).tolist()
    vec = _ollama_safe([text])[0]
    _db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (_key(text), array("f", vec).tobytes()))
    _db.commit()
    return vec


def prefill(texts: list[str], batch: int = 64) -> None:
    todo = sorted({t for t in texts if not _db.execute("SELECT 1 FROM emb WHERE h=?", (_key(t),)).fetchone()})
    start = time.time()
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        vecs = _ollama_safe(chunk)
        _db.executemany("INSERT OR REPLACE INTO emb VALUES (?, ?)",
                        [(_key(t), array("f", v).tobytes()) for t, v in zip(chunk, vecs)])
        _db.commit()
        done = i + len(chunk)
        if done % (batch * 20) == 0 or done == len(todo):
            rate = done / max(time.time() - start, 1e-9)
            print(json.dumps({"embedded": done, "of": len(todo), "per_s": round(rate, 1),
                              "eta_min": round((len(todo) - done) / max(rate, 1e-9) / 60, 1)}), flush=True)


class Bge(EmbeddingBase):
    def embed(self, text, memory_action=None):
        return embed(text)


class NoLLM(LLMBase):
    def generate_response(self, *args, **kwargs):
        raise RuntimeError("infer=False must not call an LLM")


sys.modules[__name__].Bge = Bge
sys.modules[__name__].NoLLM = NoLLM
EmbedderFactory.provider_to_class["huggingface"] = f"{__name__}.Bge"
LlmFactory.provider_to_class["openai"] = (f"{__name__}.NoLLM", BaseLlmConfig)

# ------------------------------------------------------------------ data


def load() -> list[dict]:
    digest = hashlib.sha256(DATA.read_bytes()).hexdigest()
    if digest != DATA_SHA256:
        raise SystemExit(f"LongMemEval hash mismatch: {digest}")
    return json.loads(DATA.read_text(encoding="utf-8"))


def select(data: list[dict], which: str) -> list[dict]:
    pool = [q for q in data if not q["question_id"].endswith("_abs")]
    if which == "full":
        return pool
    rng = random.Random(SEED)
    out = []
    for qtype in sorted({q["question_type"] for q in pool}):
        of_type = [q for q in pool if q["question_type"] == qtype]
        out += rng.sample(of_type, PER_TYPE)
    return out


def turns(q: dict) -> list[dict]:
    out = []
    for sid, session in zip(q["haystack_session_ids"], q["haystack_sessions"]):
        for t in session:
            if t["content"].strip():
                out.append({"role": t["role"], "content": t["content"], "session": sid,
                            "evidence": bool(t.get("has_answer"))})
    return out

# ------------------------------------------------------------------ arms


def run_mem0(ts: list[dict], question: str, root: Path) -> tuple[list[str], float, float]:
    memory = Memory.from_config({
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": "e19", "path": str(root / "qdrant"), "on_disk": True,
            "embedding_model_dims": DIMS}},
        "embedder": {"provider": "huggingface", "config": {"embedding_dims": DIMS}},
        "llm": {"provider": "openai", "config": {}},
        "history_db_path": str(root / "history.db"),
    })
    try:
        start = time.perf_counter()
        for t in ts:
            memory.add([{"role": t["role"], "content": t["content"]}], user_id="e19", infer=False)
        ingest = time.perf_counter() - start
        start = time.perf_counter()
        hits = memory.search(question, filters={"user_id": "e19"}, top_k=TOP_K)["results"]
        query = time.perf_counter() - start
    finally:
        for closer in (lambda: memory.vector_store.client.close(), lambda: memory.db.close()):
            try:
                closer()
            except Exception:  # noqa: BLE001
                pass
    return [h["memory"] for h in hits], ingest, query


def run_aura(ts: list[dict], question: str, root: Path, capture: bool) -> tuple[list[str], float, float]:
    brain = Aura(str(root / ("aura_cap" if capture else "aura_flat")))
    brain.set_embedding_fn(embed)
    try:
        start = time.perf_counter()
        for t in ts:
            if capture:
                channel = "user-claude-code" if t["role"] == "user" else "agent-claude-code"
                brain.store(t["content"], level=Level.Domain, channel=channel, deduplicate=False)
            else:
                brain.store(t["content"], level=Level.Domain, deduplicate=False)
        ingest = time.perf_counter() - start
        start = time.perf_counter()
        rows = brain.recall_structured(question, top_k=TOP_K)
        query = time.perf_counter() - start
    finally:
        brain.close()
    return [r["content"] for r in rows], ingest, query

# ------------------------------------------------------------------ metrics


def judge(ranked: list[str], ts: list[dict], answer_sessions: set[str]) -> dict:
    evidence = {t["content"] for t in ts if t["evidence"]}
    sessions_of: dict[str, set[str]] = {}
    for t in ts:
        sessions_of.setdefault(t["content"], set()).add(t["session"])
    rel = [c in evidence for c in ranked[:TOP_K]]
    sess = [bool(sessions_of.get(c, set()) & answer_sessions) for c in ranked[:TOP_K]]
    found = {c for c in ranked[:TOP_K] if c in evidence}
    dcg = sum(1 / math.log2(i + 2) for i, r in enumerate(rel) if r)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(evidence), TOP_K)))
    return {
        "turn_any@5": any(rel[:5]), "turn_any@10": any(rel[:10]),
        "turn_all@10": bool(evidence) and evidence <= found,
        "sess_any@5": any(sess[:5]), "sess_any@10": any(sess[:10]),
        "ndcg@10": dcg / ideal if ideal else 0.0,
        "n_evidence": len(evidence), "returned": len(ranked),
    }


def run(which: str) -> None:
    questions = select(load(), which)
    rows_path = HERE / f"rows_{which}.jsonl"
    done = {json.loads(l)["question_id"] for l in rows_path.read_text(encoding="utf-8").splitlines()
            if l.strip()} if rows_path.exists() else set()
    for q in questions:
        if q["question_id"] in done:
            continue
        ts = turns(q)
        answer_sessions = set(q["answer_session_ids"])
        row = {"question_id": q["question_id"], "type": q["question_type"], "turns": len(ts)}
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            root = Path(d)
            results = {"M": run_mem0(ts, q["question"], root),
                       "A-cap": run_aura(ts, q["question"], root, capture=True),
                       "A-flat": run_aura(ts, q["question"], root, capture=False)}
        for arm, (ranked, ingest, query) in results.items():
            row[arm] = {**judge(ranked, ts, answer_sessions), "ingest_s": round(ingest, 2),
                        "query_s": round(query, 4)}
        with rows_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        print(json.dumps({"q": q["question_id"], "type": q["question_type"],
                          **{a: [row[a]["turn_any@10"], round(row[a]["ndcg@10"], 2)] for a in ARMS}}), flush=True)


def analyze(which: str) -> None:
    rows = [json.loads(l) for l in (HERE / f"rows_{which}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    keys = ("turn_any@5", "turn_any@10", "turn_all@10", "sess_any@5", "sess_any@10", "ndcg@10")

    def agg(rs):
        return {a: {k: round(statistics.mean(float(r[a][k]) for r in rs), 3) for k in keys}
                | {"query_ms_median": round(1000 * statistics.median(r[a]["query_s"] for r in rs), 1),
                   "ingest_s_median": round(statistics.median(r[a]["ingest_s"] for r in rs), 2)}
                for a in ARMS}

    overall = agg(rows)
    by_type = {t: agg([r for r in rows if r["type"] == t]) | {"n": sum(r["type"] == t for r in rows)}
               for t in sorted({r["type"] for r in rows})}
    ssa = by_type.get("single-session-assistant", {})
    gates = {
        "G1": overall["A-cap"]["turn_any@10"] >= overall["M"]["turn_any@10"] - 0.05,
        "G2": bool(ssa) and ssa["A-cap"]["turn_any@10"] >= ssa["A-flat"]["turn_any@10"] - 0.05,
        "G3": overall["A-cap"]["turn_any@10"] >= overall["A-flat"]["turn_any@10"] - 0.03,
    }
    result = {"set": which, "questions": len(rows), "gates": gates, "overall": overall, "by_type": by_type}
    (HERE / f"results_{which}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps({"questions": len(rows), "gates": gates}, indent=1))
    for arm in ARMS:
        o = overall[arm]
        print(f"{arm:7s} " + "  ".join(f"{k} {o[k]}" for k in keys) + f"  query {o['query_ms_median']} ms")
    for t, v in by_type.items():
        print(f"{t:26s} n={v['n']:3d} " + "  ".join(f"{a} {v[a]['turn_any@10']}" for a in ARMS))


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    which = sys.argv[2] if len(sys.argv) > 2 else "sample"
    if cmd == "embed":
        questions = select(load(), which)
        texts = [t["content"] for q in questions for t in turns(q)] + [q["question"] for q in questions]
        prefill(texts)
    elif cmd == "run":
        run(which)
    elif cmd == "analyze":
        analyze(which)


if __name__ == "__main__":
    main()
