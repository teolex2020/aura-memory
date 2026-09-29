"""E22b follow-up: does the core identity block reproduce the tested prototype?

Deterministic, no model. For every E22b question: is the needed identity fact
in the core `recall()` context, does any untrusted marker reach the
first-hand part, and does the core block hold the same facts as the
prototype K block?
Usage (mem0 venv, core build on PYTHONPATH): python core_check.py
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("e16_runner", HERE.parent / "reasoned_recall" / "run.py")
e16 = importlib.util.module_from_spec(_spec)
sys.modules["e16_runner"] = e16
_spec.loader.exec_module(e16)

from aura import Level  # noqa: E402

HEADER = "[ABOUT THE USER — first-hand facts that may matter]"


def block_facts(context: str) -> list[str]:
    if HEADER not in context:
        return []
    block = context.split(HEADER, 1)[1].split("=== MEMORY CONTEXT ===")[0]
    return [line[4:] for line in block.splitlines() if line.startswith("  - ")]


def main():
    personas = [json.loads(l) for l in (HERE / "data" / "personas.jsonl").read_text(encoding="utf-8").splitlines()
                if l.strip()]
    present = inference = leaks = same = compared = 0
    for persona in personas:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            brain = e16.build_store(persona, directory)
            identity = sorted((r for r in brain.search(level=Level.Identity, limit=1000) if e16.first_hand(r)),
                              key=lambda r: r.created_at, reverse=True)
            for q in persona["questions"]:
                context = brain.recall(q["question"], token_budget=e16.BUDGET)
                base = brain.recall(q["question"], token_budget=e16.BUDGET, format="levels")  # unused: format check
                first_hand = context.split("[UNTRUSTED MEMORY")[0]
                leaks += any(m in first_hand for m in persona["untrusted_markers"])
                if q["type"] == "inference":
                    inference += 1
                    present += q["identity_marker"] in context
                core = block_facts(context)
                brain.set_identity_block_enabled(False)
                plain = brain.recall(q["question"], token_budget=e16.BUDGET)
                brain.set_identity_block_enabled(True)
                prototype = [t for t in (r.content for r in identity) if t not in plain]
                proto_block = block_facts(e16.block(prototype) + plain)
                compared += 1
                same += core == proto_block
            brain.close()
    result = {"inference_identity_present": f"{present}/{inference}",
              "untrusted_in_first_hand": leaks,
              "core_block_equals_prototype": f"{same}/{compared}"}
    (HERE / "core_check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
