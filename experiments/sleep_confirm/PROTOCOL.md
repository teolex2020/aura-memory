# E63: confirm "sleep" with outdated marks on fresh data

Status: **frozen 2026-10-08**, before any model call. **Test only.**

## Question

In E62 an idle pass linked versions of facts. At answer time, older
facts were marked "outdated: updated by #N" and the newest version was
added. That arm (K2) reached 94.7% on FactConsolidation single-hop with
one reader call. The answer-time chain reached 96.7% with about three
calls. K2 was added after a diagnosis, so it is exploratory.

E63 tests the same method, unchanged, on data E62 never touched:
1. **FactConsolidation 262k.** This is the largest size, which E62 left
   out: about 17k facts, with 100 single-hop and 100 multi-hop questions.
2. **LongMemEval, fresh questions.** These are real conversations, where
   versions are the user's own statements.
   - **knowledge-update:** 40 questions that are not in E35's sample. This is
     where marks should help.
   - **temporal-reasoning:** 40 questions that are not in E35's sample.
     Marks could hurt here, because some questions ask about an earlier
     value or an elapsed time (E61).

   Both sets are drawn with `random.Random(63)` from the non-abstention
   questions of each type.

## Method (frozen from E62, adapted only where the data differs)

The idle pass and the reader are both `gemini-3.1-flash-lite` at
temperature 0. No word lists are used.

**FactConsolidation 262k**: E62's code path, unchanged.
- The idle pass checks every fact against its 8 nearest newer neighbours.
  Facts go in batches of 10.
- At answer time, R0 is E46's top 10. K2 is the same top 10, with each
  linked fact marked `[outdated: updated by fact #N]` and the newest linked
  version added.
- The official template is used.
- R0 and CN results are reused from E46 and E52b.

**LongMemEval**:
- **Records.** Each record is something the user said, with its session time.
  Records are ordered by time and given numbers (a larger number is later).
- **Embeddings.** Each record is embedded with bge-m3 (own cache).
- **Idle pass.** Each record is checked against those of its 8 nearest
  records that are later and have cosine ≥ 0.6. Seeds go in batches of
  10, with texts capped at 300 characters. The processor lists
  `[earlier, later]` pairs where the later statement gives a new value for
  the same thing about the user.
- **C′.** The reader gets the cosine top 10 over the records.
- **K2.** The reader gets the same top 10. Each record with a later linked
  version is marked `[outdated: updated by what the user said on <date>]`.
  The newest linked version is added if it is not already shown.
- **Reader and judge.** The reader prompt is E35's; the judge is the
  official one.

## Hypotheses

| | Hypothesis |
|---|---|
| Y1 | FactConsolidation 262k single-hop: K2 ≥ R0 + 10 pp (R0 80%, CN 95%) |
| Y2 | LongMemEval knowledge-update (fresh 40): K2 ≥ C′ + 5 pp |
| Y3 | LongMemEval temporal-reasoning (fresh 40): K2 ≥ C′ − 2 pp (no harm) |

Also reported:
- multi-hop at 262k;
- idle cost per 1,000 records;
- links made;
- an approximate link precision on FactConsolidation. This is measurement only and is not part of the method: the two facts share their wording up to the last value.
- every K2-vs-C′ disagreement on LongMemEval, read by hand, including whether
  the question asks about an earlier value.

The hypotheses are reported, not used as ship decisions.

## Budget

Own cache, hard stop at **$3**. Estimate: FactConsolidation idle ~$0.6,
LongMemEval idle ~$1.0, reading and judging ~$0.2.
