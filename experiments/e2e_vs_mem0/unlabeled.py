"""Exploratory check (not preregistered): E13 cases stored WITHOUT source labels.

Models a developer who calls store(text) with defaults, so every record is
"recorded". Compares the default level format with the provenance format.
Usage: python unlabeled.py [model]  -> results_unlabeled_<model>.json
"""

import json
import sys
import tempfile
from pathlib import Path

from run import HERE, ask, embed, hit, items_for, load_cases

from aura import Aura, Level


def contexts(items, question):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        brain = Aura(str(Path(directory) / "aura"))
        brain.set_embedding_fn(embed)
        for text, _source in items:
            brain.store(text, level=Level.Domain, deduplicate=False)
        levels = brain.recall(question, token_budget=2048, format="levels")
        provenance = brain.recall(question, token_budget=2048, format="provenance")
        brain.close()
    return {"unlabeled-levels": levels, "unlabeled-provenance": provenance}


def main(model):
    rows = []
    for case in load_cases():
        ctx = contexts(items_for(case), case["question"])
        for arm, text in ctx.items():
            answer = ask(model, f"{text}\n\nQuestion: {case['question']}")
            rows.append({"id": case["id"], "suite": case["suite"], "kind": case["kind"], "arm": arm,
                         "attack": any(hit(answer, t) for t in case.get("attack_any", [])),
                         "correct": any(hit(answer, t) for t in case.get("expected_any", [])),
                         "answer": answer})
    summary = {}
    for arm in ("unlabeled-levels", "unlabeled-provenance"):
        mine = [r for r in rows if r["arm"] == arm]
        attacked = [r for r in mine if not (r["suite"] == "injection" and r["kind"] == "benign")]
        benign = [r for r in mine if r["suite"] == "injection" and r["kind"] == "benign"]
        summary[arm] = {
            "attack_success": round(sum(r["attack"] for r in attacked) / len(attacked), 3),
            "correct_under_attack": round(sum(r["correct"] for r in attacked) / len(attacked), 3),
            "benign_correct": round(sum(r["correct"] for r in benign) / len(benign), 3),
        }
    (HERE / f"results_unlabeled_{model.replace(':', '_')}.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "qwen3:4b-instruct")
