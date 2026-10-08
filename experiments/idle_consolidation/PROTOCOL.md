# E62: analysis while idle ("sleep") instead of at answer time

Status: **frozen 2026-10-08**, before any model call. **Test only.**

## Question

E59–E61 left one untested path for the analytical processor.

What failed at answer time:
- a long context fails on facts that changed (E59);
- no cheap signal tells when the processor is needed (E60);
- running the chain at answer time on plain questions costs ~2.4 calls and
  ~1.7 s, and slightly hurts (E61).

The untested path is to let the processor work **while idle**: link versions
of facts and gather repeated mentions ahead of time. The answer then stays
cheap (retrieval plus one reader call), but it reads memory that is already
in order. Older versions are kept, never deleted: E61 showed that "newer
wins" breaks questions about a previous value.

## Idle passes

The model is `gemini-3.1-flash-lite`, temperature 0, for every idle pass. No
word lists are used.

**FactConsolidation: version links.**
- Seeds: every fact.
- Each seed is checked against its 8 nearest facts by bge-m3 cosine
  similarity (the E46 vectors) that have a larger serial number.
- The processor gets batches of 10 seeds, each with those newer neighbours.
  It lists `[seed, newer]` pairs where the newer fact states the same
  relation about the same subject with a different value.
- Pools identical across hops are processed once.
- Sizes: 6k, 32k and 64k.

**LongMemEval: notes.**
- One pass per haystack, reading all of the user's words in time order:
  - each record is shown with its session time;
  - each record is capped at 600 characters.
- The processor writes at most 40 note lines of two kinds:
  - **changes:** `thing: old value (time) → new value (time)`, with both
    values kept;
  - **repeated mentions:** each mention with its time, and the total when
    the mentions can be counted.
- Notes use only what the user said.
- Each note line becomes a record, embedded with bge-m3 and labelled as a
  consolidation note.

## Arms at answer time

Every arm uses one reader call.

| Set | Arm | The reader sees |
|---|---|---|
| FactConsolidation (600 questions: 3 sizes × 2 hops × 100) | R0 | E46's top 10, reused |
| | **K** | the same top 10 plus, for each retrieved fact with a version link, its newest linked version (links followed to the end). The old fact stays. Official template. |
| | CN | E52b's answer-time chain, reused, for reference |
| LongMemEval (E35's 120) | C′ | cosine top 10 over the user's words (bge-m3) |
| | **K** | cosine top 10 over the user's words **plus** the notes |
| | C | E35's U, which uses Aura's hybrid recall; reused for reference |

The LongMemEval reader prompt is E35's, and the official judge is used.

## Hypotheses

| | Hypothesis |
|---|---|
| Z1 | version links fix single-hop at answer-time cost: K ≥ 90% on FactConsolidation single-hop (R0 82.5%, CN 96.2%) |
| Z2 | notes do not hurt: K ≥ C′ − 2 pp on LongMemEval |
| Z3 | notes help where versions or repeated mentions matter: on knowledge-update + multi-session + temporal-reasoning, K ≥ C′ + 5 pp |

Also reported:
- idle cost in tokens, $, and per 1,000 records;
- multi-hop results;
- how many links and notes were made.

The hypotheses are reported, not used as ship decisions.

## Budget

Own cache, hard stop at **$3**. Estimate:
- FactConsolidation links: about $0.8;
- LongMemEval notes: about $0.6;
- reading and judging: about $0.3.
