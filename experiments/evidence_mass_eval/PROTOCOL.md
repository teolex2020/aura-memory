# Consistent decay of outcome evidence

2026-09-10. Fixed before evaluating the new arms. This is an exploratory,
single-mechanism follow-up to context_importance_eval. The source data and its
last 20% have already been examined; no part of this run is an independent holdout.
No search or fitting of parameters is performed. Production policy is unchanged.

## Hypothesis and intervention

The previous utility prototype discounts accumulated outcome benefit but divides
by a lifetime receipt count. A sustained signal therefore eventually disappears.
Replace that denominator with effective evidence mass discounted on the same clock.
Keep half-life 128 event epochs, alpha 1, strength/activation effects, admission,
lookup, context attribution, tie-breaking, feedback generations and all other
mechanisms fixed. This is not a proposed universal TTL or a solution to scheduling.

On receipt at time t, with f = 2^(-(t - last_feedback)/128):

    benefit = f * benefit + outcome
    mass = f * mass + 1

At scoring time, compute f for the elapsed time since that receipt:

    mean = (f * benefit) / (1 + f * mass)
    bonus = sign(mean) * ln(1 + abs(mean))

There is no second outer discount of the new bonus. The fixed prior mass 1 lets
confidence vanish with stale evidence instead of cancelling decay in the ratio.
The legacy formula remains unmodified in control arms. Store mass as f32 and
benefit as f64; measure actual slot size and check numerical tolerances. All arms
use the same entry representation. Verify baseline replay against original
non-timing outputs; a size change must be disclosed and prevents claiming exact
budget-matched isolation against the historical outputs.

## Fixed arms and evaluation

Replay route_decay, no_decay, frequency, recency, legacy utility, legacy contextual
utility (attenuation 0.25), mass utility and mass contextual utility (attenuation
0.25). Reuse the pinned opaque chronological input, source hash, budgets 2/4/8 KiB,
60/20/20 boundaries and delayed feedback semantics of the previous experiment.
The first 80% supplies online learning; the last 20% supplies exploratory metrics.
No validation-based selection occurs this time. Write the fixed configuration
before replay. Forgetting remains allowed; no forgotten-ID history is added.

Primary comparison: mass utility minus legacy utility, and contextual mass utility
minus legacy contextual utility. Also compare both new arms against the previously
selected route_decay baseline. Report macro accuracy, each cell, coverage,
post-context-change subset, rejected admissions, dropped feedback and memory/time
costs. Paired case-cluster bootstrap: 1,000 resamples, same source stratification
and case weights across budgets as before; descriptive intervals on reused data.

Mechanism checks: continuous correct/incorrect outcomes retain a bounded signal
after long runs; stale evidence loses influence; opposite outcomes can reverse
the signal; receipt batching agrees with explicit per-epoch decay; forgotten
generation receipts are ignored. Preserve existing prequential and budget tests.

Continuation criterion for each arm: >=1 pp macro improvement over its legacy
counterpart, no cell loss >2 pp, and no loss after context change where >=100
such predictions exist. Report competitiveness against route_decay separately.
Even passing these exploratory criteria does not authorize a production promotion;
independent host-task evidence and a new evaluation source remain necessary.

Repeat the full replay and require identical non-timing outputs. Keep the original
experiment and its recorded outputs intact. Record failed results as well as gains.
