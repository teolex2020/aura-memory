"""E21: how memory is framed for the model. See PROTOCOL.md.

Reuses E20 (retrieval, context format, Gemini reader and judge, cache):
    python run.py        -> rows.jsonl, results.json
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("e20run", HERE.parent / "longmemeval_answers" / "run.py")
e20 = importlib.util.module_from_spec(_spec)
sys.modules["e20run"] = e20
_spec.loader.exec_module(e20)

ARMS = ("M", "A-cap")
CONDITIONS = ("R0", "F0", "F1")
NEUTRAL = "You are a helpful assistant."
FRAME = (
    "These are excerpts from your past conversations with this user. Use them to answer questions "
    "about what the user said or did, and to tailor advice and recommendations to the user's "
    "preferences, plans and situation; for advice, combine them with your general knowledge. Say "
    "you do not know only when the question asks for a specific fact that is not in them."
)
REFUSAL = re.compile(r"(do not|don't|does not|doesn't) (have|contain)|no (specific )?information|"
                     r"not (mentioned|available|in (my|the) memor)", re.I)


def prompt(condition: str, q: dict, ranked: list[str]) -> tuple[str, str]:
    if condition == "R0":
        return e20.READER_SYSTEM, e20.reader_prompt(q, ranked)
    if condition == "F0":
        return NEUTRAL, e20.reader_prompt(q, ranked)
    return NEUTRAL, (f"Current date: {q['question_date']}\n\n"
                     f"Retrieved memories:\n\n{FRAME}\n\n{e20.context_for(q, ranked)}\n\n"
                     f"Question: {q['question']}")


def one(job):
    q, arm, condition, ranked = job
    system, user = prompt(condition, q, ranked)
    answer = e20.gemini(system, user)["text"]
    verdict = e20.gemini(None, e20.judge_prompt(q, answer))["text"]
    return {"question_id": q["question_id"], "type": q["question_type"], "arm": arm, "condition": condition,
            "correct": verdict.strip().lower().startswith("yes") or "yes" in verdict.lower()[:10],
            "refusal": bool(REFUSAL.search(answer[:400])), "answer": answer, "verdict": verdict}


def main() -> None:
    qs = {q["question_id"]: q for q in e20.questions()}
    retrieved = e20.load_retrieved()
    work = [(q, arm, c, retrieved[qid][arm]) for qid, q in qs.items() for arm in ARMS for c in CONDITIONS]
    rows = []
    with ThreadPoolExecutor(4) as pool:
        for i, row in enumerate(pool.map(one, work)):
            rows.append(row)
            if i % 60 == 59:
                print(json.dumps({"done": i + 1, "of": len(work)}), flush=True)
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

    def rate(rs, key):
        return round(sum(r[key] for r in rs) / len(rs), 3) if rs else None

    types = sorted({r["type"] for r in rows})
    table = {}
    for arm in ARMS:
        for c in CONDITIONS:
            mine = [r for r in rows if r["arm"] == arm and r["condition"] == c]
            table[f"{arm}/{c}"] = {
                "accuracy": rate(mine, "correct"), "refusal": rate(mine, "refusal"),
                "other_types": rate([r for r in mine if r["type"] != "single-session-preference"], "correct"),
                **{t: rate([r for r in mine if r["type"] == t], "correct") for t in types}}
    a = {c: table[f"A-cap/{c}"] for c in CONDITIONS}
    pref = "single-session-preference"
    gates = {"P1": a["F1"][pref] >= a["R0"][pref] + 0.25,
             "P2": a["F1"]["other_types"] >= a["R0"]["other_types"] - 0.03,
             "P3": a["F1"][pref] >= a["F0"][pref] + 0.10}
    result = {"gates": gates, "table": table}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(gates))
    for k, v in table.items():
        print(f"{k:10s} acc {v['accuracy']}  pref {v[pref]}  other {v['other_types']}  refusal {v['refusal']}")


if __name__ == "__main__":
    main()
