# Citation-locked retrieval experiment results

Date: 2026-09-02\
Aura: 1.59.0 working tree\
Corpus: 15 controlled retrieval episodes\
Valid answerable episodes: 9\
Unsafe, conflicted, incomplete, or unanswerable episodes: 6

## Structural gate

The prototype uses Aura's real immutable-lineage verification and evidence
admission. It adds an isolated retrieval-episode contract: routed candidates,
the subset actually opened, required atomic claim keys, and a final
`allow`/`abstain` decision.

| Metric | Ordinary candidate check | Citation lock |
|---|---:|---:|
| Unsafe proposals allowed | 6/6 | 0/6 |
| Valid answers preserved | 9/9 | 9/9 |
| Required abstentions enforced | 0/6 | 6/6 |
| Router classification | — | 15/15 |
| Estimated model-context tokens | 739 | 432 (-41.54%) |
| Finalization median | — | 0.0007 ms |
| Finalization p95 | — | 0.0015 ms |

All four release-mode tests and the structural acceptance gate passed.

## Local-model A/B

Both arms used the same questions and deterministic decoding. The baseline saw
ordinary recall candidates. The locked arm saw only evidence opened for that
episode and admitted by Aura as citable.

| Local model | Baseline safe | Locked safe | Gain | Unsupported answers | Paired regressions |
|---|---:|---:|---:|---:|---:|
| Qwen 3.5 4B Q4_K_M | 12/15 | 15/15 | +20.00 pp | 3 -> 0 | 0 |
| Phi-4 Mini Instruct Q4_K_M | 12/15 | 14/15 | +13.33 pp | 3 -> 1 | 0 |
| Combined | 24/30 | 29/30 | +16.67 pp | 6 -> 1 | 0 |

Qwen fully obeyed the locked evidence boundary. Phi improved substantially but
returned one partial answer for a compound question: it cited the available
codename while saying the requested launch date was absent, instead of returning
the required full `UNKNOWN`. The structural finalizer rejects this exact case
because one required atomic claim has no opened support.

This is useful negative evidence: filtered prompts alone are not a sufficient
implementation of citation locking. The value comes from combining filtered
retrieval with a deterministic final gate over opened evidence and declared
atomic support requirements.

## Decision and integration outcome

The effect is material and survived two different local models with zero paired
regressions. Aura therefore integrated the following as an opt-in read path:

1. an ephemeral `RetrievalEpisode` read model;
2. opened-evidence receipts scoped to that episode;
3. deterministic citation admission using the existing evidence layer;
4. atomic support coverage and explicit abstention reasons.

Do not integrate the paper's PostgreSQL/pgvector storage, three LLM search loops,
or a mandatory LLM router. Keep routing deterministic by default and let host
agents provide richer routing or claim decomposition when available.

The production implementation lives in `src/retrieval_episode.rs`, is exported
through the Rust facade and Python wheel, and leaves all existing recall APIs
unchanged. The complete Aura test suite and an installed-wheel Python smoke test
passed after integration.
