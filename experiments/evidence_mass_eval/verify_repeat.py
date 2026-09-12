"""Reproduce every non-timing result; preserve historical experiment artifacts."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
SOURCE = ROOT.parent / "context_importance_eval"


def stable(value):
    if isinstance(value, dict):
        return {k: stable(v) for k, v in value.items() if k != "policy_ns_per_event"}
    if isinstance(value, list):
        return [stable(v) for v in value]
    return value


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    names = ["configuration.json", "results.json", "diagnostics.json"]
    before = {name: json.loads((ROOT/name).read_text()) for name in names}
    old_files = [REPO/"examples/context_importance_eval.rs", SOURCE/"results.json",
                 SOURCE/"selection.json", SOURCE/"verification.json", SOURCE/"PROTOCOL.md"]
    old_hashes = {str(p.relative_to(REPO)): digest(p) for p in old_files}
    subprocess.run(["cargo", "run", "--release", "--offline", "--no-default-features",
                    "--example", "evidence_mass_eval"], cwd=REPO, check=True)
    after = {name: json.loads((ROOT/name).read_text()) for name in names}
    assert stable(before) == stable(after), "A non-timing result changed"
    assert old_hashes == {str(p.relative_to(REPO)): digest(p) for p in old_files}
    timings = {}
    for arm, runs in before["results.json"]["arms"].items():
        for first, second in zip(runs, after["results.json"]["arms"][arm]):
            timings[f"{arm}/{first['dataset']}/{first['budget']}"] = [
                first["policy_ns_per_event"], second["policy_ns_per_event"]]
    files = [REPO/"examples/evidence_mass_eval.rs", ROOT/"PROTOCOL.md", ROOT/"verify_repeat.py"]
    verification = {"non_timing_results_identical": True,
        "historical_artifacts_unchanged": True, "historical_sha256": old_hashes,
        "source_sha256": {str(p.relative_to(REPO)): digest(p) for p in files},
        "two_run_policy_ns_per_event": timings,
        "limits": "Exploratory reused data; mean policy operation time excludes host bookkeeping and parsing."}
    (ROOT/"verification.json").write_text(json.dumps(verification, indent=2), encoding="utf-8")
    print("PASS: identical non-timing replay and unchanged historical artifacts")


if __name__ == "__main__":
    main()
