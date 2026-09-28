# E9: why fusion trails plain BGE — preregistered protocol

Date frozen: 2026-09-28, before any fusion variant was run.

## Question

With the same BGE vectors, Aura finds all multi-hop evidence for 115/280
questions and plain BGE for 181/280 (E7). Hypothesis: equal-weight RRF gives
three correlated lexical signals (SDR, BM25, n-gram) three votes against one
embedding vote. Which fusion arrangement closes the gap, without harming the
no-embedding path?

## Modes (`set_recall_fusion_mode`)

`equal` (current), `embedding_only` (diagnostic: pipeline loss vs plain BGE),
`family` (lexical signals merged into one list, then fused 1:1 with the
embedding), `bm25_embedding` (classic hybrid).

## Split (fixed before running)

- **Selection set:** LoCoMo conversations 0–4. The mode is chosen here only.
- **Held-out set:** conversations 5–9. Read once, for the chosen mode vs `equal`.

Selection rule: highest multi-hop all-gold@500 tokens among the non-diagnostic
modes (`equal`, `family`, `bm25_embedding`); ties broken by all-gold@100.

## Gates (held-out)

| Gate | Pass |
|---|---|
| H1 | chosen mode multi-hop all-gold@500 ≥ `equal` + 5 |
| H2 | temporal all-gold@500 not more than 3 below `equal` |
| H3 | `aura_plain` (no embeddings) rankings identical to `equal` for every question |

Reported, not gated: gap to plain BGE; `embedding_only` vs plain BGE.
