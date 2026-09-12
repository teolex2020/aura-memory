# Cognitive importance experiment v1 — frozen protocol

Date: 2026-09-09. Goal: improve cognitive forgetting under a bounded state budget.
Deletion is allowed in every policy. There is no production archive or cold tier.

This is a synthetic **retention-only** experiment. The evaluator knows the IDs
required by a task and checks whether they remain available. It does not measure
natural-language retrieval or model answer quality. Policies cannot inspect future
tasks, hidden record roles, or the evaluator's full source pool.

Compare the actual Aura `Record` activation/importance/route-decay functions with:

- `route_decay`: current route-state tick, discard below the existing alive floor,
  enforce the experimental byte budget using `Record::importance`;
- `no_decay`: the same importance ranking, with aging disabled;
- `frequency`: activation count ranking, without aging;
- `recency`: most recent exposure/ingestion, without aging;
- `utility`: no mandatory age deletion; importance plus a learned-weight signal
  from prior, observable task outcomes. Feedback value fades over cognitive epochs
  with a horizon selected on development data. Budget pressure can delete records.

The cap and overflow selector added to `route_decay` are experimental: Aura does
not currently expose this exact bounded policy. These arms compare selection
mechanisms, not complete SDK deployments. Existing source behavior is used directly;
maintenance persistence is deliberately outside this experiment.

Each policy stores the same entry schema, including feedback counters and last-use
epochs. The byte cap covers JSON-serialized retained Records and policy-entry
metadata. It is an exact representation budget, **not a process RSS measurement**;
allocator/collection overhead and one incoming candidate buffer are not included.
Record text size varies. The policy has no unbounded history of forgotten IDs.
Timing covers policy maintenance, scoring, and selection, excluding trace generation
and evaluator bookkeeping. Report it as local experiment overhead, not SDK latency.

Signals: successful complete tasks issue benefit receipts to contributing retained
records, dividing task cost across required evidence. An observed irrelevant
exposure can issue a negative receipt. Merely retrieving a record is not a positive
receipt. Receipts arrive only after a decision; missing evidence is not reinserted.
All policies receive the same external event stream, but observe outcomes only for
their own retained records. This is simulated host feedback, not inferred truth.

Cases: stationary use, frequent distracting exposure, delayed rare expensive tasks,
context shift, and noisy feedback. Each trace includes a warm-up and subsequent
streaming arrivals; only post-warm-up tasks contribute to the evaluation objective.

Fit utility alpha in {0, 0.25, 0.5, 1, 2} and feedback half-life in {8, 32, 128}
epochs on train seeds 100..103. Shortlist the best three settings using train
cost-weighted task success, then pick one on validation seeds 200..203. Freeze
before opening test seeds 300..311. Evaluate budgets 12, 24 and 36 KiB separately.
No test-set refit. Scenario labels and names are evaluator-only.

Primary outcome: fraction of task error-cost avoided, with a task successful only
if all required evidence remains. Secondary: ordinary task success, rare-task
success, successful discards of distracting records, retained bytes, selection
timings and per-case paired differences. Use project-seed cluster bootstrap for
an interval on the overall paired difference; budgets/cases of one seed stay together.

Prototype advancement gate (not authorization for production integration):

1. Every arm respects the serialized state cap after each event.
2. Utility exceeds the strongest baseline selected on validation by at least
   1 percentage point on held-out weighted success; paired 95% interval lower bound > 0.
3. No held-out case/budget cell loses more than 2 percentage points to that baseline.
4. A shuffled-receipt negative control must reduce the utility arm's overall score;
   no-feedback ablation is also reported, whether favorable or not.

Failing a gate is a useful result. Do not integrate a new production policy merely
because it wins the synthetic average. A later replay on independently collected
host-agent traces and real SDK latency/RSS is required.
