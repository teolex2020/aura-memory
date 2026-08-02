"""Benchmark exact lexical recall and verify the BM25 explanation signal."""

import os
import statistics
import sys
import tempfile
import time

from aura import Aura, Level


def run(record_count: int = 10_000, query_count: int = 500) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        brain = Aura(os.path.join(tmp, "bm25"))
        for index in range(record_count):
            brain.store(
                f"deployment event {index} completed with CODE_{index:06d}",
                level=Level.Domain,
                deduplicate=False,
            )

        latencies = []
        bm25_traces = 0
        for index in range(query_count):
            code = f"CODE_{(index * 7919) % record_count:06d}"
            started = time.perf_counter()
            explanation = brain.explain_recall(code, top_k=5, expand_connections=False)
            latencies.append((time.perf_counter() - started) * 1_000)
            if explanation["items"] and explanation["items"][0]["trace"]["bm25"]:
                bm25_traces += 1

        brain.close()

    ordered = sorted(latencies)
    return {
        "records": record_count,
        "queries": query_count,
        "mean_ms": statistics.mean(latencies),
        "median_ms": statistics.median(latencies),
        "p95_ms": ordered[int(query_count * 0.95)],
        "p99_ms": ordered[int(query_count * 0.99)],
        "bm25_trace_rate": bm25_traces / query_count,
    }


def main() -> None:
    record_count = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    query_count = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    result = run(record_count, query_count)
    print("Aura BM25 exact-recall benchmark")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
