"""E59: memory vs a long context window vs an analytical brief. See PROTOCOL.md. Test only.

Run with target/ci-venv (aura built). Reuses E35/E56 (LongMemEval) and E46/E52 (FactConsolidation) code and rows,
with E59's own caches. GOOGLE_API_KEY in the repo .env (never printed).
    python run.py lme       -> rows_lme.jsonl (B long context, D brief)
    python run.py mab       -> rows_mab.jsonl (B long context)
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
(HERE / "cache").mkdir(exist_ok=True)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _own_cache(mod, attr_path: str, file: str, budget: float) -> None:
    setattr(mod, attr_path, HERE / "cache" / file)
    mod._cache.clear()
    path = getattr(mod, attr_path)
    if path.exists():
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                r = json.loads(line)
                mod._cache[r["k"]] = r
    mod.BUDGET_USD = budget


e35 = e20 = e46 = None  # loaded per phase: LongMemEval needs aura (ci-venv), FactConsolidation needs pyarrow (remy venv)


def _lme_modules() -> None:
    global e35, e20
    e56 = _load("e56", EXP / "journal_lookup" / "run.py")
    e35, e20 = e56.e35, e56.e20
    _own_cache(e35, "CACHE_PATH", "gemini_lme.jsonl", 3.0)


def _mab_modules() -> None:
    global e46
    e52 = _load("e52", EXP / "detective_chain" / "run.py")
    e46 = e52.e46
    _own_cache(e46, "CACHE", "gemini_mab.jsonl", 2.0)


PRICE = (0.25, 1.50)


def cache_usd(file: str) -> float:
    path = HERE / "cache" / file
    if not path.exists():
        return 0.0
    total = 0.0
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            u = json.loads(line).get("usage", {})
            total += u.get("promptTokenCount", 0) * PRICE[0] / 1e6 + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
    return round(total, 3)

BRIEF = """You are a memory processor. From the memories below, write at most 5 short lines for another model that will answer the question:
- what in these memories bears on the question, with dates;
- when memories conflict, which one is newer;
- if nothing bears on it, say so.
Do not answer beyond what the memories say.

Memories:
{memories}

Question: {question}"""


def lme_questions() -> list[dict]:
    per_type: dict[str, list] = {}
    for q in e35.questions():
        per_type.setdefault(q["question_type"], [])
        if len(per_type[q["question_type"]]) < 10:
            per_type[q["question_type"]].append(q)
    return [q for qs in per_type.values() for q in qs]


def whole_history(q: dict) -> str:
    blocks = []
    for _, date, s in e35.sessions(q):
        turns = "\n".join(f"{'User' if t['role'] == 'user' else 'Assistant'}: {t['content']}" for t in s if t["content"].strip())
        blocks.append(f"[Session time: {date}]\n{turns}")
    return "\n\n".join(blocks)


def timed(fn, *a):
    t0 = time.perf_counter()
    out = fn(*a)
    return out, round(1000 * (time.perf_counter() - t0))


def lme_one(q: dict) -> list[dict]:
    rows = []
    # B: whole history
    prompt = f"Current date: {q['question_date']}\n\nConversation history:\n\n{whole_history(q)}\n\nQuestion: {q['question']}"
    rec, ms = timed(e35.gemini, e35.NEUTRAL, prompt, 1024)
    v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], rec["text"]), 64)["text"]
    rows.append({"qid": q["question_id"], "type": q["question_type"], "arm": "B", "correct": v.strip().lower().startswith("yes"),
                 "in_tokens": rec["usage"].get("promptTokenCount", 0), "ms": ms})
    # D: brief from C's 10 records, then answer from the brief
    ranked = RETRIEVED[q["question_id"]]["U"]["ranked"]
    memories = e35.context_for(q, "U", ranked)
    brief, ms_b = timed(e35.gemini, None, BRIEF.format(memories=memories, question=q["question"]), 300)
    prompt = f"Current date: {q['question_date']}\n\nMemory brief:\n\n{brief['text']}\n\nQuestion: {q['question']}"
    rec, ms_a = timed(e35.gemini, e35.NEUTRAL, prompt, 1024)
    v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], rec["text"]), 64)["text"]
    rows.append({"qid": q["question_id"], "type": q["question_type"], "arm": "D", "correct": v.strip().lower().startswith("yes"),
                 "in_tokens": rec["usage"].get("promptTokenCount", 0), "brief_chars": len(brief["text"]),
                 "memory_chars_C": len(memories), "processor_in_tokens": brief["usage"].get("promptTokenCount", 0),
                 "ms": ms_a, "processor_ms": ms_b})
    return rows


RETRIEVED: dict = {}


def lme() -> None:
    global RETRIEVED
    _lme_modules()
    RETRIEVED = e35.load_retrieved()
    out = []
    with ThreadPoolExecutor(6) as ex:
        for n, rows in enumerate(ex.map(lme_one, lme_questions()), 1):
            out.extend(rows)
            if n % 10 == 0:
                print(json.dumps({"lme": n, "usd": round(e35.spent(), 3)}), flush=True)
    (HERE / "rows_lme.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out), encoding="utf-8")


def mab_jobs():
    for task in e46.tasks():
        if task["size"] not in ("6k", "32k", "64k"):
            continue
        pool = "\n".join(t for _, t in task["facts"])
        for qi in range(25):
            yield task, qi, pool


def mab_one(job) -> dict:
    task, qi, pool = job
    pred, ms = timed(e46.read, pool, task["questions"][qi])
    golds = task["answers"][qi] if isinstance(task["answers"][qi], list) else [task["answers"][qi]]
    return {"name": task["name"], "hop": task["hop"], "size": task["size"], "q": qi, "arm": "B",
            "correct": any(e46.SUB_EM(pred, str(g)) for g in golds), "in_chars": len(pool), "ms": ms}


def mab() -> None:
    _mab_modules()
    out = []
    with ThreadPoolExecutor(6) as ex:
        for n, r in enumerate(ex.map(mab_one, mab_jobs()), 1):
            out.append(r)
            if n % 25 == 0:
                print(json.dumps({"mab": n, "usd": round(e46.spent(), 3)}), flush=True)
    (HERE / "rows_mab.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out), encoding="utf-8")


def load(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").split("\n") if x.strip()]


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def analyze() -> None:
    lrows = load(HERE / "rows_lme.jsonl")
    qids = {r["qid"] for r in lrows}
    e35_rows = [r for r in load(EXP / "capture_value" / "rows.jsonl") if r["qid"] in qids and r["arm"] in ("N", "U", "F")]
    by = lambda arm, rows: [r for r in rows if r["arm"] == arm]
    lme_res = {"questions": len(qids),
               "A_none": pct(r["correct"] for r in by("N", e35_rows)),
               "C_retrieved_user_words": pct(r["correct"] for r in by("U", e35_rows)),
               "C2_retrieved_full_turns": pct(r["correct"] for r in by("F", e35_rows)),
               "B_whole_history": pct(r["correct"] for r in by("B", lrows)),
               "D_brief": pct(r["correct"] for r in by("D", lrows))}
    types = sorted({r["type"] for r in lrows})
    lme_res["by_type"] = {t: {"A": pct(r["correct"] for r in by("N", e35_rows) if r["type"] == t),
                              "B": pct(r["correct"] for r in by("B", lrows) if r["type"] == t),
                              "C": pct(r["correct"] for r in by("U", e35_rows) if r["type"] == t),
                              "D": pct(r["correct"] for r in by("D", lrows) if r["type"] == t)} for t in types}
    b, d = by("B", lrows), by("D", lrows)
    lme_res["cost"] = {
        "B_input_tokens_median": statistics.median(r["in_tokens"] for r in b),
        "B_answer_ms_median": statistics.median(r["ms"] for r in b),
        "C_memory_tokens_median_est": round(statistics.median(r["memory_chars_C"] for r in d) / 4),
        "D_brief_tokens_median_est": round(statistics.median(r["brief_chars"] for r in d) / 4),
        "D_answer_input_tokens_median": statistics.median(r["in_tokens"] for r in d),
        "D_processor_input_tokens_median": statistics.median(r["processor_in_tokens"] for r in d),
        "D_ms_median_answer_plus_processor": statistics.median(r["ms"] + r["processor_ms"] for r in d)}

    mrows = load(HERE / "rows_mab.jsonl")
    keys = {(r["name"], r["q"]) for r in mrows}
    r0 = [r for r in load(EXP / "stale_facts" / "rows.jsonl") if r["arm"] == "R0" and (r["name"], r["q"]) in keys]
    cn = [r for r in load(EXP / "detective_chain" / "rows_b.jsonl") if (r["name"], r["q"]) in keys]
    mab_res = {"questions": len(keys)}
    for hop in ("sh", "mh"):
        mab_res[hop] = {"B_long_context": pct(r["correct"] for r in mrows if r["hop"] == hop),
                        "C_retrieved": pct(r["correct"] for r in r0 if r["hop"] == hop),
                        "D_chain_newest": pct(r["correct"] for r in cn if r["hop"] == hop)}
        mab_res[hop]["by_size"] = {s: {"B": pct(r["correct"] for r in mrows if r["hop"] == hop and r["size"] == s),
                                       "C": pct(r["correct"] for r in r0 if r["hop"] == hop and r["size"] == s),
                                       "D": pct(r["correct"] for r in cn if r["hop"] == hop and r["size"] == s)}
                                   for s in ("6k", "32k", "64k")}
    mab_res["B_input_chars_median"] = statistics.median(r["in_chars"] for r in mrows)
    mab_res["B_answer_ms_median"] = statistics.median(r["ms"] for r in mrows)

    res = {"longmemeval": lme_res, "factconsolidation": mab_res}
    res["hypotheses"] = {
        "H1_context_enough_on_lme": abs(lme_res["B_whole_history"] - lme_res["C_retrieved_user_words"]) <= 3,
        "H2_long_context_fails_on_conflicts": mab_res["mh"]["B_long_context"] <= mab_res["mh"]["D_chain_newest"] - 10,
        "H3_brief_as_good_and_short": lme_res["D_brief"] >= lme_res["C_retrieved_user_words"] - 2
        and lme_res["cost"]["D_brief_tokens_median_est"] <= 0.3 * lme_res["cost"]["C_memory_tokens_median_est"]}
    res["usd"] = {"lme": cache_usd("gemini_lme.jsonl"), "mab": cache_usd("gemini_mab.jsonl")}
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"lme": lme, "mab": mab, "analyze": analyze}[sys.argv[1]]()
