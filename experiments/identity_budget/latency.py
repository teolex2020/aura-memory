"""E15 cache check: median latency of repeated identical recall() calls.

Usage: python latency.py <label>   -> latency_<label>.json
"""

import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

from aura import Aura, Level

HERE = Path(__file__).resolve().parent
QUERY = "What do I need to remember about the deployment of service 7?"


def timed(fn, n=50):
    fn()  # warm
    samples = []
    for _ in range(n):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return round(statistics.median(samples), 3)


def main(label):
    with tempfile.TemporaryDirectory() as directory:
        brain = Aura(directory)
        for i in range(400):
            source = "recorded" if i % 3 else "retrieved"
            brain.store(f"Deployment note {i}: service {i % 37} in region {i % 11} uses release train {i % 5}",
                        level=Level.Domain, source_type=source, deduplicate=False)
        result = {
            "label": label,
            "levels_ms": timed(lambda: brain.recall(QUERY, format="levels")),
            "provenance_ms": timed(lambda: brain.recall(QUERY, format="provenance")),
        }
        brain.close()
    (HERE / f"latency_{label}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1])
