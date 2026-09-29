"""E22b: always-on identity block, powered re-test. See PROTOCOL.md.

Reuses the E22 runner (same block construction) and answers every arm 3 times.
Usage (mem0 venv): python run.py [model]  -> results_<model>.json
"""

from __future__ import annotations

import importlib.util
import json
import statistics
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("e16_runner", HERE.parent / "reasoned_recall" / "run.py")
e16 = importlib.util.module_from_spec(_spec)
sys.modules["e16_runner"] = e16
_spec.loader.exec_module(e16)
e13 = e16._e13

from aura import Level  # noqa: E402

RUNS = 3
ARMS = ("B", "K", "KR")
# Fix run (Amendment D2): K is the core block itself, B the same recall with it off.
CORE = "--core" in sys.argv


def main(model: str) -> None:
    personas = [json.loads(l) for l in (HERE / "data" / "personas.jsonl").read_text(encoding="utf-8").splitlines()
                if l.strip()]
    rows = []
    for persona in personas:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            brain = e16.build_store(persona, directory)
            identity = sorted((r for r in brain.search(level=Level.Identity, limit=1000) if e16.first_hand(r)),
                              key=lambda r: r.created_at, reverse=True)
            k_texts = [r.content for r in identity]
            for q in persona["questions"]:
                if CORE:
                    brain.set_identity_block_enabled(False)
                base = brain.recall(q["question"], token_budget=e16.BUDGET)
                if CORE:
                    brain.set_identity_block_enabled(True)
                    core_k = brain.recall(q["question"], token_budget=e16.BUDGET)
                phrases, _ = e16.hints(model, q["question"])
                r_texts = []
                for phrase in phrases:
                    for hit in brain.recall_structured(phrase, top_k=5):
                        rec = brain.get(hit["id"])
                        if rec is not None and e16.first_hand(rec) and rec.content not in base \
                                and rec.content not in r_texts:
                            r_texts.append(rec.content)
                k_new = [t for t in k_texts if t not in base]
                contexts = {
                    "B": base,
                    "K": core_k if CORE else e16.block(k_new) + base,
                    "KR": e16.block(k_new + [t for t in r_texts if t not in k_new]) + base,
                }
                for arm, context in contexts.items():
                    added = context[: len(context) - len(base)]
                    answers = [e13.ask(model, f"{context}\n\nQuestion: {q['question']}") for _ in range(RUNS)]
                    rows.append({
                        "id": q["id"], "persona": persona["id"], "lang": persona["lang"], "type": q["type"],
                        "arm": arm,
                        "identity_present": (q.get("identity_marker", "") in context)
                        if q["type"] == "inference" else None,
                        "correct_runs": [any(e13.hit(a, t) for t in q["expected_any"]) for a in answers],
                        "untrusted_in_block": any(m in added for m in persona["untrusted_markers"]),
                        "added_chars": len(added), "answers": answers,
                    })
                print(json.dumps({"id": q["id"], **{r["arm"]: sum(r["correct_runs"]) for r in rows[-3:]}}),
                      flush=True)
            brain.close()

    summary = {"model": model, "runs": RUNS}
    for arm in ARMS:
        mine = [r for r in rows if r["arm"] == arm]
        inf = [r for r in mine if r["type"] == "inference"]
        ctl = [r for r in mine if r["type"] == "control"]

        def per_run(group):
            return [sum(r["correct_runs"][i] for r in group) / len(group) for i in range(RUNS)]

        inf_runs, ctl_runs = per_run(inf), per_run(ctl)
        summary[arm] = {
            "identity_present": round(sum(r["identity_present"] for r in inf) / len(inf), 3),
            "inference_correct": round(statistics.mean(inf_runs), 3),
            "inference_runs": [round(x, 3) for x in inf_runs],
            "control_correct": round(statistics.mean(ctl_runs), 3),
            "control_runs": [round(x, 3) for x in ctl_runs],
            "untrusted_in_block": sum(r["untrusted_in_block"] for r in mine),
            "median_added_chars": sorted(r["added_chars"] for r in mine)[len(mine) // 2],
            "by_lang_inference": {lang: round(statistics.mean(per_run([r for r in inf if r["lang"] == lang])), 3)
                                  for lang in ("uk", "en")},
        }
    b, k = summary["B"], summary["K"]
    summary["gates"] = {
        "J1": k["identity_present"] >= b["identity_present"] + 0.30,
        "J2": k["inference_correct"] >= b["inference_correct"] + 0.20,
        "J3": k["control_correct"] >= b["control_correct"] - 0.05,
        "J4": k["untrusted_in_block"] == 0,
    }
    summary["core"] = CORE
    (HERE / f"results_{'fix_' if CORE else ''}{model.replace(':', '_')}.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else "qwen3:4b-instruct")
