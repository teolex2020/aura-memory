# AuraSDK Benchmarks

Reproducible performance benchmarks for AuraSDK.

## Quick Run

```bash
# Full summary (1,000 records)
python benchmarks/bench_all.py

# Custom scale
python benchmarks/bench_all.py 10000
```

## Individual Benchmarks

```bash
# Store latency at 1K, 10K, 100K records
python benchmarks/bench_store.py

# Recall latency: cold / warm / cached
python benchmarks/bench_recall.py

# Exact lexical BM25 recall + trace coverage
python benchmarks/bench_bm25.py 10000 500

# Counterfactual experiment: ordinary recall vs context applicability gate
cargo run --example context_applicability_experiment

# Maintenance cycle performance
python benchmarks/bench_maintenance.py
```

## Output

`bench_all.py` saves results to `benchmarks/results.json` for CI tracking.

## Reference Run

Aura `1.58.0` release wheel, Windows 10, AMD Ryzen 5 5600X, CPython 3.13.14,
1,000 records. These are observations, not latency guarantees.

| Operation | Mean | Median | P95 |
|-----------|-----:|-------:|----:|
| Store | 0.956 ms | 0.898 ms | 1.820 ms |
| Structured recall, uncached | 2.680 ms | 2.483 ms | 4.035 ms |
| Structured recall, cache hit | 0.101 ms | 0.097 ms | 0.163 ms |
| Formatted recall, cache hit | 8.6 us | 8.2 us | 8.7 us |
| Repeated maintenance cycle | - | 25.68 ms | 32.62 ms |

The first maintenance cycle after population took 487.09 ms. Run
`bench_all.py` on the target system and use `results.json` rather than treating
these reference values as an SLA.
