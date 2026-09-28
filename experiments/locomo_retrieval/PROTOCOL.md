# E7: LoCoMo retrieval baseline and embedding write path — preregistered protocol

Date frozen: 2026-09-28, before any run in this repository.

## Why

The author's earlier project measured AuraSDK 1.60 on LoCoMo
(`D:/Aura-clean/experiments/memory_embedding_retest_2026_09_27`): multi-hop
all-gold@100 was 91/280 without embeddings and 115/280 with the BGE
embedding channel, against 181/280 for plain BGE vectors; writing the index
with embeddings took 1325.87 s versus 11.6 s without. A code reading points
at `EmbeddingStore::insert`, which clones and rewrites the whole embedding
file on every write.

Per the project rule, nothing is ported or changed until it is measured here.

## Harness

`run.py` reuses the Aura-clean harness functions read-only (same corpus,
600 questions: 280 multi-hop, 320 temporal; same frozen BGE document
vectors; same scoring and token budgets). Arms: `vector_bge`, `aura_plain`,
`aura_bge` (Aura with `set_embedding_fn` returning the frozen vectors).
Every Aura ranking is saved per question.

## Runs

1. `branch_before` — this branch's build, before any change to the
   embedding store.
2. `branch_after` — after the write-path fix, same script.

## Gates

| Gate | Pass |
|---|---|
| V0 validity | `branch_before` aura_plain multi-hop all-gold@100 within ±5 of 91, and aura_bge within ±5 of 115 (the recorded 1.60 values); otherwise the branch already changed retrieval and that is reported first |
| F1 no ranking change | `branch_after` Aura rankings identical to `branch_before` for every question and both Aura arms |
| F2 write speed | `branch_after` aura_bge write time at least 10× lower than `branch_before` |
| F3 purge still clean | E1 purge verification still passes all 8 gates after the fix |

Not in scope: improving retrieval quality (a later experiment will study why
fusion trails plain BGE); reader accuracy.

## Amendment G1 (2026-09-28, after run `branch_after`)

F1 as frozen ("rankings identical for every question") failed for both
Aura arms — including `aura_plain`, which the fix does not touch. A control
run of the *unchanged* build (`branch_before_repeat`) also produced 0/600
identical ranking lists versus `branch_before`: Aura retrieval is not
reproducible across fresh indexes, so F1 was not a valid test of the fix.
F1 is therefore reported as frozen (FAIL) and complemented by F1′: the
before→after difference must not exceed the before→repeat difference
(same all-gold@100 outcome per question). The non-reproducibility itself is
recorded as a separate finding.
