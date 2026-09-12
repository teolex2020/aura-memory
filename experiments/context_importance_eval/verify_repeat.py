"""Replay the frozen evaluation; require exact equality of every non-timing result."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def stable(value):
    if isinstance(value, dict):
        return {key: stable(item) for key, item in value.items() if key != "policy_ns_per_event"}
    if isinstance(value, list):
        return [stable(item) for item in value]
    return value


def main():
    names = ["selection.json", "results.json"]
    before = {name: json.loads((ROOT / name).read_text()) for name in names}
    subprocess.run(["cargo", "run", "--release", "--offline", "--no-default-features",
                    "--example", "context_importance_eval"], cwd=REPO, check=True)
    after = {name: json.loads((ROOT / name).read_text()) for name in names}
    assert stable(before) == stable(after), "Replay changed a non-timing result"
    timing = {}
    for arm, runs in before["results.json"]["arms"].items():
        for first, second in zip(runs, after["results.json"]["arms"][arm]):
            key = f"{arm}/{first['dataset']}/{first['budget']}"
            timing[key] = [first["policy_ns_per_event"], second["policy_ns_per_event"]]
    files = [REPO / "examples/context_importance_eval.rs", ROOT / "prepare.py", ROOT / "PROTOCOL.md"]
    report = {"non_timing_results_identical": True, "includes_selection_and_bootstrap": True,
        "source_sha256": {str(p.relative_to(REPO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        "two_run_policy_ns_per_event": timing,
        "measurement_limit": "Mean policy operation time over full replay; excludes parsing and host state. Two runs, no production latency claim."}
    (ROOT / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("PASS: all non-timing selection and test results exactly reproduced")


if __name__ == "__main__":
    main()
