"""E61: does the analytical processor (E52b chain) hurt plain lookups? See PROTOCOL.md. Test only.

Run with E:/remy/app/.venv (numpy; aura is stubbed, retrieval is read from E35's files). Reuses E35 records and retrieval, E19 bge-m3 embeddings, E52b's chain.
GOOGLE_API_KEY in the repo .env (never printed).
    python run.py run       -> rows.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import re
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
(HERE / "cache").mkdir(exist_ok=True)
MAX_STEPS, TOP_K, NEIGHBOURS, CAP = 5, 10, 8, 2000


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


try:
    import aura  # noqa: F401
except ImportError:  # E35 imports aura only for its retrieval phase, which E61 reuses from disk
    import types
    sys.modules["aura"] = types.SimpleNamespace(Aura=None, Level=None)

e59 = _load("e59", EXP / "memory_vs_context" / "run.py")
e59._lme_modules()
e35, e20, e19 = e59.e35, e59.e20, e59.e35.e19
e59.HERE = HERE  # _own_cache resolves its path against e59.HERE, so the cache lands here
e59._own_cache(e35, "CACHE_PATH", "gemini.jsonl", 2.0)

STEP = """Memories from the user's earlier conversations (#number, session time, what the user said; a larger number is later):
{pool}

Rule: a later memory overrides an earlier one about the same thing.

Current date: {date}
Question: {question}
Chain so far:
{chain}

Do exactly one step. Reply with one JSON object only:
{{"link": {{"fact": <number of the memory you use>, "finding": "<what that memory gives>"}}, "next": "<the next single-fact question to look up>"}}
or, when the chain answers the question:
{{"link": {{"fact": <number>, "finding": "<what that memory gives>"}}, "final": "<answer>"}}
If no memory bears on the question: {{"link": {{"fact": null, "finding": "nothing found"}}, "final": "not in memory"}}"""
NEWER = """

Your step used memory #{serial}: "{text}".
Later memories that may be about the same thing:
{candidates}
Rule: a later memory overrides an earlier one about the same thing.
If one of these later memories states the same thing with a different value, use the latest such memory instead.
Reply with the same JSON step format."""
P2 = """Current date: {date}

Retrieved memories:

{context}

Notes from a memory processor (a step-by-step chain over the memories, with later versions checked):
{notes}

Question: {question}"""


def parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        o = json.loads(m.group(0)) if m else {}
    except Exception:
        o = {}
    return o if isinstance(o, dict) else {}


def line(r: dict) -> str:
    return f"#{r['n']} [{r['date']}] {r['text'][:CAP]}"


_qv: dict = {}
_qv_lock = threading.Lock()


def qvec(text: str) -> np.ndarray:
    with _qv_lock:
        if text in _qv:
            return _qv[text]
    v = np.asarray(e19._ollama_safe([text])[0], dtype=np.float32)  # no sqlite off the main thread
    v /= np.linalg.norm(v) or 1.0
    with _qv_lock:
        _qv[text] = v
    return v


def prepare(q: dict, ranked: list[str]) -> dict:
    """Main thread: dated records numbered by time, with their unit vectors (E19's sqlite cache)."""
    recs = []
    for r in e35.records(q, "U"):
        recs.append({"n": len(recs) + 1, "date": r["date"], "text": r["text"]})
    mat = np.asarray([e19.embed(r["text"]) for r in recs], dtype=np.float32)
    mat /= np.linalg.norm(mat, axis=1, keepdims=True).clip(1e-9)
    first_of = {}
    for r in recs:
        first_of.setdefault(r["text"], r)
    step1 = [first_of[t] for t in ranked if t in first_of]
    return {"q": q, "ranked": ranked, "recs": recs, "mat": mat, "step1": step1}


def call(prompt: str) -> tuple[dict, int]:
    rec = e35.gemini(None, prompt, 400)
    return parse(rec["text"]), rec["usage"].get("promptTokenCount", 0)


def chain(job: dict) -> dict:
    q, recs, mat = job["q"], job["recs"], job["mat"]
    by_n = {r["n"]: r for r in recs}
    links, calls, tokens, final = [], 0, 0, None
    lookup = q["question"]
    steps = 0
    for steps in range(1, MAX_STEPS + 1):
        shown = job["step1"] if steps == 1 else [recs[i] for i in np.argsort(-(mat @ qvec(lookup)))[:TOP_K]]
        chain_text = "\n".join(f"{k}. memory #{n}: {f}" for k, (n, f) in enumerate(links, 1)) or "(none)"
        prompt = STEP.format(pool="\n".join(line(r) for r in shown), date=q["question_date"],
                             question=q["question"], chain=chain_text)
        step, t = call(prompt)
        calls, tokens = calls + 1, tokens + t
        link = step.get("link") if isinstance(step.get("link"), dict) else {}
        try:
            cited = int(link.get("fact"))
        except (TypeError, ValueError):
            cited = None
        if cited in by_n:
            i = cited - 1
            later = [recs[j] for j in np.argsort(-(mat @ mat[i])) if j != i][:NEIGHBOURS]
            later = [r for r in later if r["n"] > cited]
            if later:
                again, t = call(prompt + NEWER.format(serial=cited, text=by_n[cited]["text"][:CAP],
                                                      candidates="\n".join(line(r) for r in later)))
                calls, tokens = calls + 1, tokens + t
                if isinstance(again.get("link"), dict):
                    step, link = again, again["link"]
        try:
            n = int(link.get("fact"))
        except (TypeError, ValueError):
            n = None
        links.append((n, str(link.get("finding", "")).strip()))
        if step.get("final") is not None:
            final = str(step["final"]).strip()
            break
        lookup = str(step.get("next") or "").strip()
        if not lookup:
            break
    if final is None:
        final = links[-1][1] if links else "not in memory"
    return {"final": final, "links": links, "steps": steps, "calls": calls, "tokens": tokens}


def notes(out: dict, recs: list[dict]) -> str:
    by_n = {r["n"]: r for r in recs}
    rows = []
    for k, (n, f) in enumerate(out["links"], 1):
        where = f"memory #{n} [{by_n[n]['date']}]" if n in by_n else "no memory"
        rows.append(f"{k}. {where}: {f}")
    rows.append(f"Chain's answer: {out['final']}")
    return "\n".join(rows)


def judge(q: dict, answer: str) -> bool:
    v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], answer), 64)["text"]
    return v.strip().lower().startswith("yes")


def one(job: dict) -> dict:
    q = job["q"]
    t0 = time.perf_counter()
    out = chain(job)
    chain_ms = round(1000 * (time.perf_counter() - t0))
    p2 = P2.format(date=q["question_date"], context=e35.context_for(q, "U", job["ranked"]),
                   notes=notes(out, job["recs"]), question=q["question"])
    t1 = time.perf_counter()
    ans = e35.gemini(e35.NEUTRAL, p2, 1024)
    reader_ms = round(1000 * (time.perf_counter() - t1))
    return {"qid": q["question_id"], "type": q["question_type"], "steps": out["steps"], "calls": out["calls"],
            "chain_tokens": out["tokens"], "chain_ms": chain_ms, "reader_ms": reader_ms,
            "P1": judge(q, out["final"]), "P2": judge(q, ans["text"]),
            "nothing_found": out["final"].lower().startswith("not in memory")}


def run() -> None:
    retrieved = e35.load_retrieved()
    jobs = [prepare(q, retrieved[q["question_id"]]["U"]["ranked"]) for q in e35.questions()]
    print(json.dumps({"prepared": len(jobs)}), flush=True)
    rows = []
    with ThreadPoolExecutor(6) as ex:
        for n, r in enumerate(ex.map(one, jobs), 1):
            rows.append(r)
            if n % 20 == 0:
                print(json.dumps({"done": n, "usd": round(e35.spent(), 3)}), flush=True)
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def analyze() -> None:
    rows = [json.loads(x) for x in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    c = {r["qid"]: r["correct"] for r in (json.loads(x) for x in (EXP / "capture_value" / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()) if r["arm"] == "U"}
    for r in rows:
        r["C"] = c[r["qid"]]
    types = sorted({r["type"] for r in rows})
    res = {"questions": len(rows),
           "accuracy": {a: pct(r[a] for r in rows) for a in ("C", "P1", "P2")},
           "by_type": {t: {a: pct(r[a] for r in rows if r["type"] == t) for a in ("C", "P1", "P2")} for t in types},
           "P2_vs_C": {"fixed": sum(r["P2"] and not r["C"] for r in rows), "broke": sum(r["C"] and not r["P2"] for r in rows)},
           "chain": {"steps_mean": round(statistics.mean(r["steps"] for r in rows), 2),
                     "calls_mean": round(statistics.mean(r["calls"] for r in rows), 2),
                     "tokens_median": statistics.median(r["chain_tokens"] for r in rows),
                     "ms_median": statistics.median(r["chain_ms"] for r in rows),
                     "ms_p90": sorted(r["chain_ms"] for r in rows)[int(0.9 * len(rows))],
                     "reader_ms_median": statistics.median(r["reader_ms"] for r in rows),
                     "nothing_found": pct(r["nothing_found"] for r in rows)}}
    ku_t = [r for r in rows if r["type"] in ("knowledge-update", "temporal-reasoning")]
    res["hypotheses"] = {"K1_no_harm": res["accuracy"]["P2"] >= res["accuracy"]["C"] - 2,
                         "K2_helps_on_versions": pct(r["P2"] for r in ku_t) >= pct(r["C"] for r in ku_t),
                         "K2_values": {"C": pct(r["C"] for r in ku_t), "P2": pct(r["P2"] for r in ku_t)},
                         "K3_added_ms_under_3s": res["chain"]["ms_median"] <= 3000}
    res["usd"] = round(e35.spent(), 3)
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"run": run, "analyze": analyze}[sys.argv[1]]()
