"""E35: what is worth keeping from a conversation. See PROTOCOL.md.

Run in the mem0 venv with the core build on PYTHONPATH; GOOGLE_API_KEY in the
repository's .env (never printed):
    python run.py summarize  -> Remy-style summary per session (cache/gemini.jsonl)
    python run.py embed      -> bge-m3 for the summaries (E19's cache)
    python run.py retrieve   -> retrieved.jsonl (top 10 and store size per arm)
    python run.py answer     -> reader answers
    python run.py judge      -> judgements
    python run.py analyze    -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import statistics
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


e19 = _load("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
e20 = _load("e20", HERE.parent / "longmemeval_answers" / "run.py")
from aura import Aura, Level  # noqa: E402

MODEL = "gemini-3.1-flash-lite"
PRICE = (0.25, 1.50)  # $ per 1M input / output tokens
BUDGET_USD = 4.5
ARMS = ("N", "U", "F", "S", "US")
MEMORY_ARMS = ("U", "F", "S", "US")
NEUTRAL = "You are a helpful assistant."  # E21 F0

# ------------------------------------------------------------------ Gemini

_lock = threading.Lock()
CACHE_PATH = HERE / "cache" / "gemini.jsonl"
(HERE / "cache").mkdir(exist_ok=True)
_cache: dict[str, dict] = {}
if CACHE_PATH.exists():
    for line in CACHE_PATH.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            rec = json.loads(line)
            _cache[rec["k"]] = rec


def spent() -> float:
    total = 0.0
    for c in _cache.values():
        u = c["usage"]
        total += u.get("promptTokenCount", 0) * PRICE[0] / 1e6
        total += (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
    return total


def gemini(system: str | None, user: str, max_out: int) -> dict:
    k = hashlib.sha256(json.dumps([MODEL, system, user, max_out]).encode()).hexdigest()
    if k in _cache:
        return _cache[k]
    if spent() > BUDGET_USD:
        raise SystemExit(f"budget ${BUDGET_USD} reached")
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": max_out}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    data = json.dumps(body).encode()
    for attempt in range(10):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=data, headers={"x-goog-api-key": e20.KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")).strip(),
                   "usage": d.get("usageMetadata", {}),
                   "finish": (d.get("candidates") or [{}])[0].get("finishReason")}
            with _lock:
                _cache[k] = rec
                with CACHE_PATH.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return rec
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {err.code}: {err.read()[:300]!r}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("Gemini: retries exhausted")

# ------------------------------------------------------------------ Remy summary (verbatim)


def summary_prompt(session: list[dict]) -> str | None:
    """remy/core/session_summary.py: user text only, 16,000-char cap, same prompt."""
    entries = [f'- User said: "{t["content"]}"' for t in session if t["role"] == "user" and t["content"].strip()]
    if not entries:
        return None
    max_chars = 16000
    log_text = "\n".join(entries)
    if len(log_text) > max_chars:
        head_budget = max_chars // 5
        tail_budget = max_chars - head_budget - 50
        log_text = log_text[:head_budget] + "\n...[truncated]...\n" + log_text[-tail_budget:]
    return (
        "You are summarizing a session with a memory-equipped AI assistant. "
        "Based on the activity log below, write a 2-3 sentence summary of what was discussed. "
        "Focus on: topics discussed, information stored, questions answered. "
        "Write in the same language the user used (Ukrainian or English). "
        "Be concise and natural.\n\n"
        f"Activity log:\n{log_text}"
    )


def summarize(session: list[dict]) -> str | None:
    prompt = summary_prompt(session)
    if not prompt:
        return None
    return gemini(None, prompt, 400)["text"] or None


def questions() -> list[dict]:
    return e19.select(e19.load(), "sample")


def sessions(q: dict):
    yield from zip(q["haystack_session_ids"], q["haystack_dates"], q["haystack_sessions"])


def summarize_phase() -> None:
    unique = {}
    for q in questions():
        for _, _, s in sessions(q):
            p = summary_prompt(s)
            if p:
                unique.setdefault(p, s)
    work = list(unique.values())
    print(json.dumps({"sessions": len(work)}), flush=True)
    with ThreadPoolExecutor(8) as pool:
        for i, _ in enumerate(pool.map(summarize, work)):
            if i % 200 == 199:
                print(json.dumps({"summarized": i + 1, "of": len(work), "usd": round(spent(), 3)}), flush=True)
    print(json.dumps({"done": len(work), "usd": round(spent(), 3)}), flush=True)


def embed_phase() -> None:
    texts = [summarize(s) for q in questions() for _, _, s in sessions(q)]
    e19.prefill([t for t in texts if t])

# ------------------------------------------------------------------ stores


def records(q: dict, arm: str) -> list[dict]:
    """(text, channel, session id, date, label) in session order."""
    out = []
    for sid, date, s in sessions(q):
        if arm in ("U", "F", "US"):
            for t in s:
                if not t["content"].strip() or (t["role"] != "user" and arm != "F"):
                    continue
                user = t["role"] == "user"
                out.append({"text": t["content"], "channel": "user-claude-code" if user else "agent-claude-code",
                            "session": sid, "date": date, "label": "User" if user else "Assistant"})
        if arm in ("S", "US"):
            text = summarize(s)
            if text:
                out.append({"text": text, "channel": "agent-claude-code", "session": sid, "date": date,
                            "label": "Session summary"})
    return out


def dir_bytes(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def retrieve() -> None:
    path = HERE / "retrieved.jsonl"
    done = {json.loads(l)["qid"] for l in path.read_text(encoding="utf-8").split("\n")
            if l.strip()} if path.exists() else set()
    for q in questions():
        if q["question_id"] in done:
            continue
        ts = e19.turns(q)
        evidence_sessions = set(q["answer_session_ids"])
        row = {"qid": q["question_id"], "type": q["question_type"]}
        for arm in MEMORY_ARMS:
            recs = records(q, arm)
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                root = Path(d) / "aura"
                brain = Aura(str(root))
                brain.set_embedding_fn(e19.embed)
                try:
                    for r in recs:
                        brain.store(r["text"], level=Level.Domain, channel=r["channel"], deduplicate=False)
                    hits = brain.recall_structured(q["question"], top_k=e19.TOP_K)
                finally:
                    brain.close()
                disk = dir_bytes(root)
            ranked = [h["content"] for h in hits]
            sessions_of: dict[str, set[str]] = {}
            for r in recs:
                sessions_of.setdefault(r["text"], set()).add(r["session"])
            row[arm] = {"ranked": ranked, "records": len(recs), "chars": sum(len(r["text"]) for r in recs),
                        "disk_bytes": disk,
                        "sess_any@10": any(sessions_of.get(c, set()) & evidence_sessions for c in ranked[:10])}
            if arm in ("U", "F"):
                row[arm]["turn_any@10"] = e19.judge(ranked, ts, evidence_sessions)["turn_any@10"]
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(json.dumps({"q": row["qid"], **{a: row[a]["sess_any@10"] for a in MEMORY_ARMS}}), flush=True)

# ------------------------------------------------------------------ answers


def context_for(q: dict, arm: str, ranked: list[str]) -> str:
    where = {}
    for r in records(q, arm):
        where.setdefault(r["text"], (r["date"], r["label"]))
    return "\n\n---\n\n".join(f"[Session time: {where[t][0]}]\n{where[t][1]}: {t}" for t in ranked)


def reader_prompt(q: dict, arm: str, ranked: list[str]) -> str:
    context = "(none)" if arm == "N" else context_for(q, arm, ranked)
    return (f"Current date: {q['question_date']}\n\n"
            f"Retrieved memories:\n\n{context}\n\n"
            f"Question: {q['question']}")


def load_retrieved() -> dict[str, dict]:
    return {r["qid"]: r for r in (json.loads(l) for l in
            (HERE / "retrieved.jsonl").read_text(encoding="utf-8").split("\n") if l.strip())}


def jobs():
    retrieved = load_retrieved()
    for q in questions():
        for arm in ARMS:
            yield q, arm, [] if arm == "N" else retrieved[q["question_id"]][arm]["ranked"]


def answer(job) -> dict:
    q, arm, ranked = job
    return gemini(NEUTRAL, reader_prompt(q, arm, ranked), 1024)


def verdict(job) -> dict:
    q, _, _ = job
    return gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], answer(job)["text"]), 64)


def run_pool(fn, label: str) -> None:
    work = list(jobs())
    with ThreadPoolExecutor(8) as pool:
        for i, _ in enumerate(pool.map(fn, work)):
            if i % 60 == 59:
                print(json.dumps({label: i + 1, "of": len(work), "usd": round(spent(), 3)}), flush=True)

# ------------------------------------------------------------------ analysis


def pct(xs) -> float:
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else 0.0


def analyze() -> None:
    retrieved = load_retrieved()
    rows = []
    for job in jobs():
        q, arm, ranked = job
        v = verdict(job)["text"].strip().lower()
        rows.append({"qid": q["question_id"], "type": q["question_type"], "arm": arm,
                     "correct": v.startswith("yes"), "answer": answer(job)["text"]})
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    acc = {a: pct(r["correct"] for r in rows if r["arm"] == a) for a in ARMS}
    types = sorted({r["type"] for r in rows})
    by_type = {t: {a: pct(r["correct"] for r in rows if r["arm"] == a and r["type"] == t) for a in ARMS} for t in types}
    rr = list(retrieved.values())
    size = {a: {"records_median": statistics.median(r[a]["records"] for r in rr),
                "chars_median": statistics.median(r[a]["chars"] for r in rr),
                "chars_total": sum(r[a]["chars"] for r in rr),
                "disk_mb_median": round(statistics.median(r[a]["disk_bytes"] for r in rr) / 1e6, 2),
                "sess_any@10": pct(r[a]["sess_any@10"] for r in rr)} for a in MEMORY_ARMS}
    for a in ("U", "F"):
        size[a]["turn_any@10"] = pct(r[a]["turn_any@10"] for r in rr)
    summary_usd = 0.0
    prompts = {summary_prompt(s) for q in questions() for _, _, s in sessions(q)} - {None}
    for p in prompts:
        u = _cache[hashlib.sha256(json.dumps([MODEL, None, p, 400]).encode()).hexdigest()]["usage"]
        summary_usd += u.get("promptTokenCount", 0) * PRICE[0] / 1e6 + \
            (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
    gates = {
        "H0": acc["F"] >= acc["N"] + 20,
        "H1": acc["U"] >= acc["F"] - 5,
        "H2": size["U"]["chars_median"] <= 0.5 * size["F"]["chars_median"],
        "H3": acc["S"] >= acc["F"] - 5,
        "H4": acc["US"] >= acc["U"] + 3,
    }
    result = {"model": MODEL, "questions": len(rows) // len(ARMS), "gates": gates, "accuracy": acc,
              "by_type": by_type, "size_and_retrieval": size, "summaries": len(prompts),
              "summary_usd": round(summary_usd, 3), "total_usd": round(spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


def main() -> None:
    cmd = sys.argv[1]
    {"summarize": summarize_phase, "embed": embed_phase, "retrieve": retrieve,
     "answer": lambda: run_pool(answer, "answered"), "judge": lambda: run_pool(verdict, "judged"),
     "analyze": analyze}[cmd]()


if __name__ == "__main__":
    main()
