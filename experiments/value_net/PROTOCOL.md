# E38: can a micro network learn from consequences what is worth keeping?

Status: **frozen 2026-10-02**, before any label, training or run.

## Question

In E37, credit given to individual records barely beat plain decay (+1.5 pp),
because a record that helped once is rarely needed again. The owner's idea:
memory needs a small network that learns **connections from experience**, not
which particular record helped. It would value a record it has never seen,
the way people judge a new situation from past ones.

The test is generalization. The network learns from outcomes in some
conversations and is tested on **other** conversations, with other people and
other records.

## Data

LoCoMo, the E37 file (SHA-256 `79fa87e9…98ff4`). The 10 conversations are
split by `random.Random(38)` into 5 for training and 5 for testing. The split
is recorded in `split.json` before labeling.

## Training labels: consequences only, no human or dataset labels

In each training conversation, memory keeps everything (as arm U in E37).
Every category 1–4 question with parseable evidence is asked right after the
session of its last evidence turn. For each question:

1. Retrieve the top 10 by bge-m3 similarity among the records stored so far.
2. The reader answers and names the records it used (E37's reader and judge,
   `gemini-3.1-flash-lite`).
3. If the judge says correct, each cited record (up to 3) is removed in turn
   and the question asked again. If that answer is wrong, the record gets a
   **positive** label.

Every other record is negative.

**Reference labels:** LoCoMo's evidence ids give a second label set. They are
used only for a reference network (V\*), never for V.

## Network

- **Input:** the record's bge-m3 embedding (1,024 numbers, normalized) plus
  four language-agnostic numbers:
  - log of length in characters;
  - share of digit characters;
  - whether a photo caption is present;
  - relative position in its session.

  No words and no dictionaries.
- **Model:** a multilayer perceptron, 1,028 → 64 (ReLU) → 1 (sigmoid), about
  66,000 weights.
- **Training:** binary cross-entropy weighted by inverse class frequency, Adam
  (learning rate 1e-3), L2 1e-4, 300 full-batch epochs, seed 38. Features are
  standardized with training statistics. The hyperparameters are fixed here
  and not tuned.
- **Runtime:** numpy, run with the `D:\Aura-clean\.venv` interpreter as a tool
  (numpy 2.5.2). No lab code is used.

## Test

The 5 test conversations, with E37's exact stream: the same 40 questions per
conversation, the same schedule, capacity 25% of turns, the same retrieval,
reader and judge. Each arm evicts its lowest score first; ties go to the
oldest.

| Arm | Score |
|---|---|
| U | no eviction (reference) |
| R | recency (E37) |
| D | decay with refresh (E37) |
| L | length in characters (no learning; E36 found length predicts durable content) |
| **V** | the network's predicted value, trained on consequence labels |
| V\* | the same network trained on evidence labels (reference) |

U, R and D reuse E37's cached answers wherever the prompts are identical.

## Metrics

- **Primary:** accuracy on the 200 test questions.
- **Also reported:**
  - per category;
  - the share of evidence turns still kept when asked;
  - ROC AUC of V and V\* for "is an evidence turn" on test records;
  - the number of training labels;
  - cost.

## Gates

| Gate | Pass |
|---|---|
| H0 | forgetting matters on the test set: U ≥ R + 10 pp |
| H1 | experience beats the fixed rule: V ≥ D + 5 pp |
| H2 | it learned more than "longer is better": V ≥ L + 3 pp |

## Decision rule

- **H1 and H2 pass:** a learned value network is worth building into the core,
  pre-trained on public conversations and then adapted on the user's own
  outcomes. The next question is real-life outcome signals.
- **V fails and V\* passes:** value is learnable, but consequence labels are
  too scarce or too noisy. Better outcome signals come before any network.
- **Both fail:** value is not learnable from content and simple structure in
  this setting. Report this, and do not build the network.

## Limits stated in advance

- **Small data:** 5 + 5 conversations from one synthetic dataset.
- **The outcome is a judge against gold answers,** which is a best case.
- **Single seed and fixed hyperparameters,** so variance is not estimated.
- **The network scores records without knowing future questions,** which is
  the real situation for forgetting.

## Freeze record

- `run.py` sha256 `356003ce1e1a51ae3d2d24222529b52ec6bb74a4d9a438af4aca50e2580cdde0`.
- Split (seed 38): train conv-26, conv-30, conv-41, conv-47, conv-50; test conv-42, conv-43, conv-44, conv-48, conv-49.
- 688 training questions. API calls go through E37's cache, so the budget cap ($4.5) counts E37's $0.50 too.
