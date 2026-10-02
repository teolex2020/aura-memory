# E39: does E38's value net hold across splits and seeds?

Status: **frozen 2026-10-02**, before any new label, training or run.

## Question

E38 passed all gates on one split and one seed. The value net beat decay by
+16 pp (CI +8…+23.5), but beat "keep the longer messages" by only +4 pp, with
a CI that includes 0. The owner wants more tests before anything is built
into the product. This experiment asks:

1. Does the gain over decay hold for other train/test splits and seeds?
2. Does the net add anything over length?
3. Is the gain due to content (the embedding) or only to simple structure?

## Data and splits

The data are LoCoMo, E37's stream and questions, unchanged: 40 per
conversation, the same schedule, capacity 25%.

| Splits | |
|---|---|
| S0 | E38's split (seed 38) |
| S1–S5 | 5 more random splits into 5 training and 5 test conversations, seeds 39–43 |

- **Labels:** consequence labels from E38's procedure for **all 10**
  conversations. The labels of a conversation do not depend on the split. The
  5 conversations E38 did not label are labeled first.

## Arms on each split's test conversations

| Arm | What | Training seeds |
|---|---|---|
| U, R, D | as in E37; reused from E37's rows (same stream and questions) | — |
| L | longer messages kept first (no learning) | — |
| V | E38's network (embedding + 4 structural numbers), consequence labels | 2 (seed and seed + 100) |
| S | the same training on the 4 structural numbers only, no embedding | 1 |

- **Network settings:** as frozen in E38.
- **Retrieval:** E38's code, the same cosine top 10 as E37.

## Metrics

- **Per split:** accuracy on its 200 test questions. V is the mean of its two
  seeds.
- **Primary:** the mean over the 6 splits of V − D, V − L and V − S.
- **Also reported:**
  - each split's numbers and the spread between seeds;
  - the share of evidence turns still kept;
  - cost.

## Gates

| Gate | Pass |
|---|---|
| R1 | gain over decay is robust: V > D in all 6 splits **and** mean(V − D) ≥ 5 pp |
| R2 | the net adds over length: mean(V − L) ≥ 3 pp **and** V > L in at least 5 of 6 splits |
| R3 | content matters: mean(V − S) ≥ 3 pp |

## Decision rule

- **R1 fails:** E38 was luck. No value-based forgetting.
- **R1 passes, R2 fails:** keep forgetting by content, but the simple length
  rule is enough for now. A network is not justified.
- **R1 and R2 pass:** the network earns its place.
  - If R3 also passes, it is the content that is learned.
  - If R3 fails, a structural model is enough.
- **E40,** transfer to LongMemEval, follows in every case except an R1 failure.

## Limits stated in advance

- **The splits overlap.** Each conversation is tested in several splits, so
  the splits are not independent samples.
- **One dataset,** with the outcome judged against gold answers.
- **Fixed hyperparameters.** Nothing is tuned.

## Freeze record

- `run.py` sha256 `eadb43875bf25790818d48af1bebe1b04ae64418a36454a82b55a1ab90f948b3`. API spend before this run (shared cache with E37/E38): $1.05.
