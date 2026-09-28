"""E15: identity facts under a tight token budget. See PROTOCOL.md.

Run in the mem0 venv (reuses the E13 runner for embeddings and the model):
    python run.py <label> [--model]   -> results_<label>.json
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

from aura import Aura, Level

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("e13_runner", HERE.parent / "e2e_vs_mem0" / "run.py")
_e13 = importlib.util.module_from_spec(_spec)
sys.modules["e13_runner"] = _e13
_spec.loader.exec_module(_e13)

BUDGETS = (256, 512, 1024)
ARMS = {"L": "levels", "C": "provenance"}


def main(label: str, with_model: bool) -> None:
    cases = [json.loads(l) for l in (HERE / "data" / "cases.jsonl").read_text(encoding="utf-8").splitlines()
             if l.strip()]
    rows = []
    for case in cases:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            brain = Aura(str(Path(directory) / "aura"))
            brain.set_embedding_fn(_e13.embed)
            for other in cases:
                brain.store(other["identity"], level=Level.Identity, source_type="recorded", deduplicate=False)
                for i, text in enumerate(other["related"]):
                    level = Level.Working if i % 2 else Level.Domain
                    brain.store(text, level=level, source_type="recorded", deduplicate=False)
            for budget in BUDGETS:
                for arm, fmt in ARMS.items():
                    context = brain.recall(case["question"], token_budget=budget, format=fmt)
                    row = {"id": case["id"], "lang": case["lang"], "budget": budget, "arm": arm,
                           "identity_present": case["identity_marker"] in context,
                           "context_chars": len(context)}
                    if with_model:
                        answer = _e13.ask("qwen3:4b-instruct", f"{context}\n\nQuestion: {case['question']}")
                        row["correct"] = any(_e13.hit(answer, t) for t in case["expected_any"])
                        row["answer"] = answer
                    rows.append(row)
            brain.close()
        print(json.dumps({"id": case["id"], **{f"{r['arm']}{r['budget']}": int(r["identity_present"])
                                               for r in rows[-len(BUDGETS) * len(ARMS):]}}), flush=True)
    summary = {"label": label}
    for budget in BUDGETS:
        for arm in ARMS:
            mine = [r for r in rows if r["arm"] == arm and r["budget"] == budget]
            entry = {"identity_present": round(sum(r["identity_present"] for r in mine) / len(mine), 3)}
            if with_model:
                entry["correct"] = round(sum(r["correct"] for r in mine) / len(mine), 3)
            summary[f"{arm}@{budget}"] = entry
    summary["I1"] = all(summary[f"C@{b}"]["identity_present"] >= summary[f"L@{b}"]["identity_present"] - 0.05
                        for b in BUDGETS)
    (HERE / f"results_{label}.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], "--model" in sys.argv)
