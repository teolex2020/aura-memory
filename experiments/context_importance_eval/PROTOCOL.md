# Context adaptation on historical operational event logs

Frozen before policy evaluation, 2026-09-09. The previous synthetic test seeds
300..311 will not be used. Cognitive forgetting remains allowed in every arm.

Data eligibility: inspected Aura working-memory logs do not provide enough joined
per-memory delayed task-utility receipts. Use the two existing historical helpdesk
datasets instead, with their limitations explicit. These are human operational
processes, not host-agent memory traces. The experiment measures next observed
state prediction, not correct action execution or causal task contribution.

Pin input SHA-256 to the previously recorded local source hashes. Keep source files
read-only. Export only hashed case/context/state identifiers and event times into
the local experiment input. Do not publish original row payloads. UCI context uses
the current row's category and assignment group; helpdesk has one dataset context.
No future row fields, task outcomes, or latent scenario labels enter a prediction.

Sort raw events globally by timestamp and original row position; collapse consecutive
identical states per case using past rows only. At each event: score the prediction
issued at that case's previous event; deliver its feedback; observe the transition;
issue the next prediction. Other cases can interleave. Pending predictions and
case-local workflow state belong to the external evaluator/host, not the bounded
memory. No end-of-case labels are invented from EOF.

Every policy keeps a bounded table of observed transition rules. A rule records
context, previous state, next state, observed count, activation strength/use count,
and prior outcome utility. Both contextual and global-backoff rules are eligible.
Prediction uses a matching contextual rule when available, otherwise a global one;
ties favor the higher observed count and a stable opaque key. No unbounded learned
global-majority fallback is allowed. Forgotten rules can return only from a new
observed transition, not from the evaluator's historical archive.

Arms: route-state decay, importance without decay, frequency, recency, frozen v1
utility (alpha=1, feedback half-life=128 epochs), and context-aware utility. The new
arm attenuates the additional utility contribution of rules from other contexts;
global-backoff rules remain shared. Context is supplied before each prediction.
Choose attenuation from {0, 0.25, 0.5, 1}; 1 is the no-adaptation control.
No score is allowed to create factual confirmation by itself.

Feedback is +1 for correct and -1 for wrong prediction, credited only to the rule
actually used and still retained. No feedback for abstention. Outcome is the actual
next state, not a simulator-provided importance class or arbitrary business cost.
Correct prediction does not imply that the operational action was desirable.

Chronological split per dataset: first 60% events training, next 20% validation,
last 20% held-out test. Select the attenuation on validation after the training
prefix; select the strongest baseline there too. Freeze selection on disk before
test replay. Keep learning prequentially during test, without refitting parameters.
Score partitions by outcome arrival, never use test arrivals for validation.
The raw datasets were used in an earlier, different procedural-skill experiment;
this is an independent-source test versus synthetic v1, not a globally untouched corpus.

State budgets: 2, 4 and 8 KiB of fixed-width rule slots. Charge actual Rust Entry
slot size and vector capacity, plus fixed policy fields; allocator overhead is
excluded and must be disclosed. Preallocate once; do not retain forgotten-ID maps.
Report lookup/update time observations separately from parsing and host bookkeeping.

Primary: next-state accuracy over all scored transitions (abstention counts as a
miss). Also report coverage, accuracy conditional on prediction, changed-context
subset, each dataset/budget cell, serialized input provenance and peak slots.
Changed context means the same case's currently observed context differs from its
previous context; measure the prediction issued after the change, not before it.

Advancement gate: budget respected; improvement >=1 pp over validation-selected
strongest baseline on equal-weight dataset/budget test macro accuracy; no cell
regresses >2 pp; changed-context accuracy improves where there are >=100 scored
changed-context predictions; context-permutation negative control degrades the
new arm. Sparse changed-context evidence cannot be counted as a passed gate.
Implementation clarifications fixed before running the policies: one logical epoch
is one retained input event (not one day). The compact surrogate uses Working-level
importance with no graph, salience, or promotion; it is not a full SDK benchmark.
Repeated observations increase rule observation count; prediction activates it;
positive/negative feedback changes strength by +0.1/-0.15 as in v1. Correct feedback
sets the experimental confirmation bit. Incoming rules compete for admission with
resident rules, with deterministic key ties. Charge one incoming-rule scratch slot
in addition to the policy struct and vector capacity.

The negative control permutes nonzero 64-bit context identifiers by rotating bits
left once **only in the importance channel**; lookup and receipt attribution keep
the correct context. This deliberately breaks importance-to-context correspondence
without changing observed transitions. It is an identifier-corruption control,
not a random reshuffling of event rows or a natural context change.

Report paired case-cluster bootstrap interval (1,000 resamples), including its limits with only two
source datasets. If the gate fails, keep the previous policy and report the failure.
