"""E16: facts that need a reasoning step. See PROTOCOL.md.

Run in the mem0 venv (reuses the E13 runner for embeddings and the model):
    python run.py [model]   -> results_<model>.json
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import tempfile
import time
from pathlib import Path

from aura import Aura, Level

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("e13_runner", HERE.parent / "e2e_vs_mem0" / "run.py")
_e13 = importlib.util.module_from_spec(_spec)
sys.modules["e13_runner"] = _e13
_spec.loader.exec_module(_e13)

BUDGET = 2048
BLOCK_TOKENS = BUDGET // 4
HEADER = "[ABOUT THE USER — first-hand facts that may matter]"
HINT_PROMPT = (
    "A user asks their personal assistant the question below. List up to 5 short search phrases "
    "for lasting facts about the user (health, family, work, diet, home, habits, limits, "
    "commitments...) that could change the right answer. One phrase per line, no numbering, "
    "no explanations, same language as the question.\n\nQuestion: {question}"
)


def first_hand(rec) -> bool:
    meta = rec.metadata or {}
    return (rec.source_type == "recorded"
            and meta.get("relayed_by_model") != "true"
            and meta.get("claim_certainty") not in ("hearsay", "speculative"))


def tokens(text: str) -> int:
    return int(len(text.split()) * 1.3)


def block(texts: list[str]) -> str:
    lines, used = [], 0
    for text in texts:
        cost = tokens(text) + 1
        if used + cost > BLOCK_TOKENS:
            break
        used += cost
        lines.append(f"  - {text}")
    return f"{HEADER}\n" + "\n".join(lines) + "\n\n" if lines else ""


def ask_raw(model: str, prompt: str) -> str:
    body = json.dumps({"model": model, "stream": False, "think": False,
                       "messages": [{"role": "user", "content": prompt}],
                       "options": {"temperature": 0, "num_predict": 120}}).encode()
    import urllib.request
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as response:
        return json.loads(response.read())["message"]["content"]


def hints(model: str, question: str) -> tuple[list[str], float]:
    start = time.perf_counter()
    raw = ask_raw(model, HINT_PROMPT.format(question=question))
    elapsed = (time.perf_counter() - start) * 1000
    phrases = [re.sub(r"^[\s\-*•\d.)]+", "", line).strip() for line in raw.splitlines()]
    return [p for p in phrases if p][:5], elapsed


def build_store(persona: dict, directory: str) -> Aura:
    brain = Aura(directory)
    brain.set_embedding_fn(_e13.embed)
    for i, text in enumerate(persona["ordinary"]):
        brain.store(text, level=Level.Working if i % 2 else Level.Domain,
                    source_type="recorded", deduplicate=False)
    for item in persona["untrusted"]:
        # Adversarial: outside claims stored at identity level.
        brain.store(item["text"], level=Level.Identity, source_type="retrieved",
                    metadata={"channel": item["channel"]}, deduplicate=False)
    for text in persona["identity"]:
        brain.store(text, level=Level.Identity, source_type="recorded", deduplicate=False)
    return brain


def main(model: str) -> None:
    personas = [json.loads(l) for l in (HERE / "data" / "personas.jsonl").read_text(encoding="utf-8").splitlines()
                if l.strip()]
    rows = []
    for persona in personas:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            brain = build_store(persona, directory)
            identity = sorted((r for r in brain.search(level=Level.Identity, limit=1000) if first_hand(r)),
                              key=lambda r: r.created_at, reverse=True)
            k_texts = [r.content for r in identity]
            for q in persona["questions"]:
                base = brain.recall(q["question"], token_budget=BUDGET)
                phrases, hint_ms = hints(model, q["question"])
                r_texts = []
                for phrase in phrases:
                    for hit in brain.recall_structured(phrase, top_k=5):
                        rec = brain.get(hit["id"])
                        if rec is not None and first_hand(rec) and rec.content not in base \
                                and rec.content not in r_texts:
                            r_texts.append(rec.content)
                k_new = [t for t in k_texts if t not in base]
                contexts = {
                    "B": base,
                    "K": block(k_new) + base,
                    "R": block(r_texts) + base,
                    "KR": block(k_new + [t for t in r_texts if t not in k_new]) + base,
                }
                for arm, context in contexts.items():
                    added = context[: len(context) - len(base)]
                    answer = _e13.ask(model, f"{context}\n\nQuestion: {q['question']}")
                    rows.append({
                        "id": q["id"], "persona": persona["id"], "lang": persona["lang"], "type": q["type"],
                        "arm": arm,
                        "identity_present": (q.get("identity_marker", "") in context) if q["type"] == "inference" else None,
                        "correct": any(_e13.hit(answer, t) for t in q["expected_any"]),
                        "untrusted_in_block": any(m in added for m in persona["untrusted_markers"]),
                        "added_chars": len(added), "hint_ms": hint_ms if arm in ("R", "KR") else 0.0,
                        "hints": phrases if arm in ("R", "KR") else None,
                        "answer": answer,
                    })
                print(json.dumps({"id": q["id"], **{r["arm"]: [r["identity_present"], int(r["correct"])]
                                                     for r in rows[-4:]}}, ensure_ascii=False), flush=True)
            brain.close()

    def rate(group, key):
        return round(sum(bool(r[key]) for r in group) / len(group), 3) if group else None

    summary = {"model": model}
    for arm in ("B", "K", "R", "KR"):
        mine = [r for r in rows if r["arm"] == arm]
        inf = [r for r in mine if r["type"] == "inference"]
        ctl = [r for r in mine if r["type"] == "control"]
        summary[arm] = {
            "identity_present": rate(inf, "identity_present"),
            "inference_correct": rate(inf, "correct"),
            "control_correct": rate(ctl, "correct"),
            "untrusted_in_block": sum(r["untrusted_in_block"] for r in mine),
            "median_added_chars": sorted(r["added_chars"] for r in mine)[len(mine) // 2],
            "median_hint_ms": round(sorted(r["hint_ms"] for r in mine)[len(mine) // 2], 1),
        }
    b = summary["B"]
    summary["gates"] = {arm: {
        "J1": summary[arm]["identity_present"] >= b["identity_present"] + 0.30,
        "J2": summary[arm]["inference_correct"] >= b["inference_correct"] + 0.20,
        "J3": summary[arm]["control_correct"] >= b["control_correct"] - 0.05,
        "J4": summary[arm]["untrusted_in_block"] == 0,
    } for arm in ("K", "R")}
    (HERE / f"results_{model.replace(':', '_')}.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "qwen3:4b-instruct")
