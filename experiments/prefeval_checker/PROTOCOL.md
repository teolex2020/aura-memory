# E42: does the control-fact checker hold on public data (PrefEval)?

Status: **frozen 2026-10-02**, before any generation, judgment or check.

## Question

E30 found that a cheap API checker (`gemini-3.1-flash-lite` with E30's
prompt) catches 97.2% of violations of a user's control facts at 2.8% false
alarms. That was measured on our own synthetic personas. PrefEval (ICLR 2025)
is an independent public benchmark built for exactly this failure: every
question tempts a generic answer that violates the stated preference.

Does our checker agree with an independent judge on PrefEval?

## Data

PrefEval explicit preferences, 1,000 items: `siyanzhao/prefeval_explicit`,
parquet SHA-256 `31185e12…4787fe`, CC-BY-4.0. Each item has a preference, a
question and a topic.

## Candidate answers

`gemini-3.1-flash-lite`, temperature 0, at most 600 output tokens, writes two
answers per item:

- **A0, unaware:** the question alone, the way a model answers once it has
  lost the preference.
- **A1, aware:** the same question, with system prompt `The user told you
  earlier: <preference>`.

That gives 2,000 answers, with a natural mix of violations and compliance.

## Reference judge ("the truth")

- **Prompt:** PrefEval's official violation prompt (`error_type/check_violation.txt`),
  verbatim, with its official system prompt.
- **Model:** `gemini-2.5-flash`, temperature 0, thinking budget 0. This is a
  different model from the one under test.
- **Label:** violation = the `<answer>` is "Yes".
- **Unparseable judgments** are reported and excluded.

## Checker under test (the product)

E30's API checker, unchanged: its system prompt, its `Control facts: …`
format with the preference as fact 0, the answer as `Assistant answer: …`,
and `gemini-3.1-flash-lite` with temperature 0 and JSON output.

## Metrics

- **Caught:** checker says violates ÷ reference violations.
- **False alarms:** checker says violates ÷ reference non-violations.
- **Also reported:**
  - Cohen's kappa;
  - per arm (A0 / A1) and per topic;
  - the reference violation rate in A0 and A1;
  - cost.

## Gates (E30's own thresholds)

| Gate | Pass |
|---|---|
| P1 | caught ≥ 90% |
| P2 | false alarms ≤ 5% |
| P0 (sanity) | at least 100 reference violations, so the test has power |

## Decision rule

- **P1 and P2 pass:** E30 holds on independent public data. Control facts
  can be built on this checker.
- **Otherwise:** report where it fails (topics, false-alarm patterns). Do not
  build until fixed.

## Limits stated in advance

- **The reference is an LLM judge, not people.** PrefEval reports about 5%
  error for its Claude judge on 200 human checks.
- **Explicit preferences only.** The checker always receives the preference
  as a stated control fact, which is the product situation.
- **One generator model.** Violations of other models may look different.

## Freeze record

- `run.py` sha256 `2e43ce0c262c2b9775aee628418f882fe13441de6855fac918977e573a9a7582`; judge prompt `check_violation.txt` sha256 `1842a2597597b6f5083b94c77ebf4badfa92a609adde573828373f8f997b29bb` (PrefEval repo, depth-1 clone 2026-10-02).
- Harness check before freezing: one dummy call to `gemini-2.5-flash` ("Reply with the single word: ok"), no data item touched.
