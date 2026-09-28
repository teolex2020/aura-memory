# E8: recall determinism — preregistered protocol

Date frozen: 2026-09-28, before any change to tie-breaking.

## Question

E7 found that two runs of the same build on the same data produce different
rankings (0/600 identical lists, metrics ±1–3). Can identical input produce
identical recall output?

## Fixture

LoCoMo-10 (`D:/Aura-clean/target/aura-local/external-benchmarks/locomo/locomo10.json`),
conversations 0–2: every turn stored in chronological order with the same
text format as E7 (`deduplicate=False`), then the first 200 questions of
those conversations asked with `recall_structured(question, top_k=50)`.
Rankings are compared by record *content*, not id (ids are random).

## Arms

- `in_process`: build store A, query all; build store B in a fresh directory
  in the same process, query all; compare A vs B.
- `cross_process`: run the binary twice; compare the saved outputs.

## Gates

| Gate | Pass |
|---|---|
| D1 | in-process: 200/200 identical content rankings |
| D2 | cross-process: 200/200 identical content rankings |
| D3 | after any fix, E7 LoCoMo multi-hop/temporal all-gold@100 within the run-to-run noise measured in E7 (±3), and median search latency not more than 20% worse |

Run 1 measures the current code; run 2 after the fix.
