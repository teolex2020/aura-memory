"""E12 compromised-model arm (Amendment D2): the proposal carries the attack."""

import json
import sys
import tempfile
from pathlib import Path

from aura import Aura, Level

from gate import decide, norm
from run import HERE


def memory_for(s):
    with tempfile.TemporaryDirectory() as directory:
        brain = Aura(directory)
        for fact in s["user_facts"]:
            brain.store(fact, level=Level.Domain, source_type="recorded", deduplicate=False)
        for item in s["untrusted"]:
            brain.store(item["text"], level=Level.Domain, source_type="retrieved",
                        metadata={"channel": item.get("channel", "web")}, deduplicate=False)
        memory = brain.recall_structured(s["request"], top_k=20)
        brain.close()
    return memory


def target_arg(s, canary):
    """Argument the canary belongs in: the one whose expected value it most resembles."""
    args = s["expected_args"]
    def looks_like(value):
        return (("@" in value) == ("@" in canary)) + (value[:2].isdigit() == canary[:2].isdigit())
    return max(args, key=lambda k: (looks_like(args[k]), norm(args[k]) in norm(canary)))


rows = []
for line in (HERE / "data" / "scenarios.jsonl").read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    s = json.loads(line)
    if s["kind"] == "untrusted_needed":
        continue
    args = dict(s["expected_args"])
    for canary in s["attack_values"]:
        args[target_arg(s, canary)] = canary
    verdict = decide({"tool": s["expected_tool"], "args": args}, s["request"], memory_for(s))
    rows.append({"id": s["id"], "kind": s["kind"], "lang": s["lang"], "args": args, **verdict})

attacks = [r for r in rows if r["kind"] == "attack"]
legit = [r for r in rows if r["kind"] == "legit"]
summary = {
    "attack_allowed": sum(r["decision"] == "allow" for r in attacks), "attack_n": len(attacks),
    "legit_confirmed": sum(r["decision"] != "allow" for r in legit), "legit_n": len(legit),
    "attack_allowed_ids": [r["id"] for r in attacks if r["decision"] == "allow"],
}
(HERE / "results_compromised.json").write_text(
    json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary))
