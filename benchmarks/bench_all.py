"""Run all AuraSDK benchmarks and produce a summary report."""

import os
import sys
import time
import json
import tempfile
import platform
import statistics

from aura import Aura, Level, __version__

TAGS_POOL = [
    ["python", "api"], ["rust", "core"], ["deploy", "ci"],
    ["user", "preference"], ["bug", "fix"], ["design", "ui"],
    ["database", "query"], ["auth", "security"], ["test", "qa"],
    ["docs", "readme"],
]
LEVELS = [Level.Working, Level.Decisions, Level.Domain, Level.Identity]
QUERIES = [
    "user preferences and settings",
    "deployment workflow and CI",
    "authentication security issues",
    "python programming language features",
    "database query optimization",
]
N = 1_000  # default scale


def populate(brain, n):
    for i in range(n):
        content = f"Memory record {i}: topic {i % 50} with detailed context"
        brain.store(
            content,
            level=LEVELS[i % len(LEVELS)],
            tags=TAGS_POOL[i % len(TAGS_POOL)],
            deduplicate=False,
        )


def run_all(n=N):
    results = {}

    with tempfile.TemporaryDirectory() as tmp:
        brain = Aura(os.path.join(tmp, "bench.db"))

        # --- Store ---
        store_times = []
        for i in range(n):
            content = f"Bench record {i}: topic {i % 50} with context"
            t0 = time.perf_counter()
            brain.store(
                content,
                level=LEVELS[i % len(LEVELS)],
                tags=TAGS_POOL[i % len(TAGS_POOL)],
                deduplicate=False,
            )
            store_times.append((time.perf_counter() - t0) * 1000)

        results["store"] = {
            "mean_ms": round(statistics.mean(store_times), 4),
            "median_ms": round(statistics.median(store_times), 4),
            "p95_ms": round(sorted(store_times)[int(n * 0.95)], 4),
        }

        # --- Recall structured (uncached) ---
        # Every query has a unique suffix so this measures the retrieval path,
        # not a previously memoized result.
        recall_uncached_times = []
        for i in range(100):
            q = f"{QUERIES[i % len(QUERIES)]} uncached probe {i}"
            t0 = time.perf_counter()
            brain.recall_structured(q, top_k=10)
            recall_uncached_times.append((time.perf_counter() - t0) * 1000)

        results["recall_structured_uncached"] = {
            "mean_ms": round(statistics.mean(recall_uncached_times), 4),
            "median_ms": round(statistics.median(recall_uncached_times), 4),
            "p95_ms": round(sorted(recall_uncached_times)[95], 4),
        }

        # --- Recall structured (cache hit) ---
        for q in QUERIES:
            brain.recall_structured(q, top_k=10)

        recall_cached_times = []
        for i in range(100):
            q = QUERIES[i % len(QUERIES)]
            t0 = time.perf_counter()
            brain.recall_structured(q, top_k=10)
            recall_cached_times.append((time.perf_counter() - t0) * 1000)

        results["recall_structured_cached"] = {
            "mean_ms": round(statistics.mean(recall_cached_times), 4),
            "median_ms": round(statistics.median(recall_cached_times), 4),
            "p95_ms": round(sorted(recall_cached_times)[95], 4),
        }

        # --- Formatted recall (cache hit) ---
        q = QUERIES[0]
        brain.recall(q)  # prime
        formatted_cached_times = []
        for _ in range(1000):
            t0 = time.perf_counter()
            brain.recall(q)
            formatted_cached_times.append(
                (time.perf_counter() - t0) * 1_000_000
            )  # us

        results["recall_formatted_cached"] = {
            "mean_us": round(statistics.mean(formatted_cached_times), 2),
            "median_us": round(statistics.median(formatted_cached_times), 2),
            "p95_us": round(sorted(formatted_cached_times)[950], 2),
        }

        # --- Maintenance ---
        t0 = time.perf_counter()
        brain.run_maintenance()
        first_maintenance_ms = (time.perf_counter() - t0) * 1000

        maint_times = []
        for _ in range(10):
            t0 = time.perf_counter()
            brain.run_maintenance()
            maint_times.append((time.perf_counter() - t0) * 1000)

        results["maintenance"] = {
            "first_cycle_ms": round(first_maintenance_ms, 4),
            "repeated_median_ms": round(statistics.median(maint_times), 4),
            "repeated_p95_ms": round(sorted(maint_times)[9], 4),
        }

        brain.close()

    return results


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else N

    print("=" * 65)
    print(f"AuraSDK Benchmark Suite  |  {n:,} records")
    print(f"Platform: {platform.system()} {platform.release()} / {platform.processor()}")
    print(f"Python: {platform.python_version()}")
    print("=" * 65)

    results = run_all(n)

    print(f"\n  Store:                       {results['store']['mean_ms']:.3f} ms/op  (median {results['store']['median_ms']:.3f}, p95 {results['store']['p95_ms']:.3f})")
    print(f"  Recall structured uncached: {results['recall_structured_uncached']['mean_ms']:.3f} ms/op  (median {results['recall_structured_uncached']['median_ms']:.3f}, p95 {results['recall_structured_uncached']['p95_ms']:.3f})")
    print(f"  Recall structured cache hit:{results['recall_structured_cached']['mean_ms']:6.3f} ms/op  (median {results['recall_structured_cached']['median_ms']:.3f}, p95 {results['recall_structured_cached']['p95_ms']:.3f})")
    print(f"  Recall formatted cache hit: {results['recall_formatted_cached']['mean_us']:.1f} us/op   (median {results['recall_formatted_cached']['median_us']:.1f}, p95 {results['recall_formatted_cached']['p95_us']:.1f})")
    print(f"  Maintenance:                 {results['maintenance']['first_cycle_ms']:.2f} ms first cycle (repeated median {results['maintenance']['repeated_median_ms']:.2f}, p95 {results['maintenance']['repeated_p95_ms']:.2f})")

    # Save JSON for CI
    output_path = os.path.join(os.path.dirname(__file__), "results.json")
    report = {
        "records": n,
        "aura_version": __version__,
        "platform": f"{platform.system()} {platform.release()}",
        "processor": platform.processor(),
        "python": platform.python_version(),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": results,
    }
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"\n  Results saved to {output_path}")


if __name__ == "__main__":
    main()
