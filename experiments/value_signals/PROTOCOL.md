# E41: what predicts the value of a memory?

Status: **frozen 2026-10-02**, before any surprisal, judge call or analysis.

## Question

E38–E39 found that forgetting by a record's structure beats forgetting by
time. Most of that came from length, which the owner rejects as a definition
of value: a long message is not valuable because it is long. The owner asked
what value is, who judges it, and whether it can be computed.

Working definition, from decision theory (value of information): the value of
a memory is how much better future answers or actions are with it than
without it. One of its factors can be measured today, without the future:

- **irreplaceability:** how much of the record the model could not have
  predicted from the conversation and its own knowledge.

That is **surprisal**, −log P(text | context), under a language model. It is
pure mathematics, needs no dictionary and works in any language. This
experiment asks whether surprisal predicts value **beyond length**.

## Ground truth ("the judge")

- **D1, LoCoMo** (10 conversations).
  - Primary label: E38/E39 **consequence labels**, that is, removing the
    record broke a correct answer.
  - Secondary label: LoCoMo's evidence turns.
  - Sample: every record positive on either label, plus 1,500 random negatives
    (`random.Random(41)`). AUC does not depend on how many negatives are
    sampled.
- **D2, the owner's real messages** (E36, 319 messages, private, local only).
  - Primary label: `durable` (E36's labels).
  - Reported only: `restated_later`, meaning a later message restated this one
    (very few positives).
  - No D2 text leaves the computer: surprisal is computed locally, and there
    is no API judge on D2.

## Predictors

1. **Length:** log of characters.
2. **Surprisal**, under Qwen3-4B-Instruct-2507 Q8 (local llama.cpp b9870,
   Vulkan, temperature 0). The record's text is forced through a grammar after
   its context, and the model's raw log-probability of each token is read.
   - **Context, D1:** the preceding turns of the same session, up to 1,500
     characters, as `Speaker: text` lines.
   - **Context, D2:** the user's preceding messages in the same session, up to
     1,500 characters.
   - The record is cut to 600 characters.
   - **Primary measure:** mean negative log-likelihood per token
     (`surprisal_mean`), which does not scale with length.
   - **Secondary measure:** the total (`surprisal_total`).
3. **LLM judge, D1 only.** `gemini-3.1-flash-lite`, temperature 0, answers
   whether the message states a decision, plan, preference, or fact about the
   speaker's life, work or situation that would matter later. Its yes/no is
   reported as a reference, not as mathematics.

## Analysis

- **AUC** of each predictor against each label.
- **Added value over length:** 5-fold cross-validated AUC of a logistic
  regression (numpy, L2 1e-3) with length + surprisal_mean, minus the same
  with length alone. Folds are seeded with 41. On D1 folds are split by
  conversation; on D2 they are random.
- Correlation between surprisal and length.

## Gates

| Gate | Pass |
|---|---|
| M1 | surprisal adds over length: CV AUC gain ≥ 0.02 on D1 (consequence) **and** on D2 (durable) |
| M2 | surprisal alone: AUC(surprisal_mean) ≥ 0.60 on both |

## Decision rule

- **M1 and M2 pass:** irreplaceability measured as surprisal is a
  mathematical, language-agnostic component of value. The next step combines
  it with consequences: probability of need and impact.
- **Fails:** surprisal does not capture value in this form. Report the LLM
  judge's result as the alternative, and why.

## Limits stated in advance

- **Forced tokenization.** The grammar can choose a different tokenization than
  natural decoding. That gives a lower bound on probability, with a little
  noise.
- **D2's labels** come from Claude labelers (E36), not from the owner.
- **D1 is a synthetic two-person chat.** Its outcome is judged against gold
  answers.
- **One model.** Surprisal depends on what that model already knows.

## Freeze record

- `run.py` sha256 `985b55a0a42e9673e7d9f3900a7b209e9df04d0c18e0a8217e321f4e09f96e17`.
- D1 sample: 1,466 positives (consequence or evidence) + 1,500 negatives = 2,966; D2: 319 messages (145 durable, 9 restated later).
- Disclosure: one D1 record's surprisal was computed as a harness check before freezing (conv-26/D1:2); it stays in the data.
- API cap for the judge: $1 on top of earlier spend.
