# E45: do the signals an agent can see predict whether its work really succeeded?

Status: **frozen 2026-10-02**, before any trajectory is parsed for this
question.

## Question

To learn from consequences in real life (E37–E40), memory needs an outcome
signal it can see, because there is no judge with a gold answer. In coding
agents the candidates are what the journal already captures: the exit codes
of commands, whether the last test run passed, and whether the agent
finished. Do these agent-visible signals predict the real outcome?

If they do not, learning value from them would learn noise.

## Data

`nebius/SWE-rebench-openhands-trajectories`: 67,074 OpenHands runs
(Qwen3-Coder) on 1,823 repositories, CC-BY-4.0, `trajectories.parquet` as
downloaded on 2026-10-02 (SHA-256 recorded in the freeze record). The real
outcome is `resolved` (the hidden SWE tests pass).

## Signals (computed from the trajectory only, no model)

A command is a tool call whose output contains `[The command completed with
exit code N.]`.

| Signal | Definition |
|---|---|
| S1 `fail_share` | share of commands with a non-zero exit code |
| S2 `last_exit_ok` | the last command's exit code is 0 |
| S3 `last_test_ok` | the last command that runs tests exited 0. A test command is one whose command line contains `pytest`, `py.test`, `tox`, `unittest`, `nose`, `npm test`, `yarn test`, `jest`, `go test`, `cargo test`, `mvn test`, `gradle test` or `rspec`; none means 0.5 |
| S4 `steps` | log of the number of assistant turns |
| S5 `submitted` | `exit_status == "submit"` |
| R `pred_passes_gen_tests` | provided by the dataset: the patch passes tests generated outside the agent. Reference only: an agent would not see it |

S3's test-runner names are tool names, not a natural-language dictionary.

## Metrics

- AUC of each signal for `resolved`.
- 5-fold cross-validated AUC of a logistic regression on S1–S5. Folds are
  split by repository, seed 45.
- Precision: P(resolved | S3 = 1 and S5 = 1), and the base rate of
  `resolved`.

## Gates

| Gate | Pass |
|---|---|
| O1 | agent-visible signals predict success: CV AUC(S1–S5) ≥ 0.70 |
| O2 | "tests passed and finished" is a usable positive label: precision ≥ base rate + 20 pp |

## Decision rule

- **O1 and O2 pass:** in-trajectory outcome signals are usable weak labels
  for learning memory value in coding agents. The journal can compute them
  today.
- **Otherwise:** they are too noisy. Real-life value learning needs explicit
  user feedback, or an outside verifier like R.

The base rate (32,161 of 67,074 resolved, 47.9%) comes from the dataset card
and was known when the gates were set. That is why O2 is an absolute lift
and not a ratio, which could not be reached at this base rate.

## Limits stated in advance

- **One agent family** (OpenHands with one model).
- **SWE-bench-style tasks only.**
- **Trajectory level, not record level.** This tests the outcome signal, not
  which memory record caused it.

## Freeze record

- `run.py` sha256 `9e45d5c39e535fba33a694019952a98de952da482a732b135e334ccd71f52230`; `trajectories.parquet` sha256 `14048dd1fcd22ce094b6e85f8a38f223a9ef1327031aaaad052804870212efa1`.
- Harness check before freezing: the parser was run on the first trajectory only (field names, exit-code pattern); no outcome was looked at.
