# E52b: the detective checks for newer testimony at every link

Status: **frozen 2026-10-07**, before any E52b model call. Extends
[E52](PROTOCOL.md). **Test only**.

## Question

In E52 the chain (CH) lifted multi-hop from 10.2% to 26.0%. Two problems
remained:
- the gold fact was never shown in 44% of multi-hop questions;
- when it was shown, the model picked it only 47% of the time.

Verified-but-wrong chains (280) rested on facts that a newer fact
overrides. A detective checks whether newer testimony contradicts each
statement. Does doing that at every link fix the chain?

## Arm CN: chain plus a newest-fact check per link

CN is identical to E52's CH: same data, model, step prompt, at most 5
steps, 10 records per step. One thing is added. After every step whose
link cites a valid serial *N*:

1. **Neighbours.** Take the 8 records most similar to the cited record
   itself (bge-m3 cosine against the cited fact's text, over the whole
   pool, excluding the fact itself), keeping only those with serial > *N*.
   These are the candidates for "the same thing, said later". The search is
   deterministic and uses no word lists.
2. If there are any, the model gets one more call: the original step
   prompt, plus this block:

   ```
   Your step used fact #N: "<text>".
   Newer facts that may be about the same thing:
   <candidates with serial numbers>
   Rule: a larger serial number is newer and overrides an older fact about the same thing.
   If one of these newer facts states the same relation with a different value, use the newest such fact instead.
   Reply with the same JSON step format.
   ```

   Its reply replaces the step: the link, then `next` or `final`.
3. If there are no candidates, the step stands.

The final step's link is checked the same way.

## Baseline and scoring

- **Baseline:** E52's CH rows, reused (same model and step prompt). E46's
  R0 is reported for context.
- **Scoring:** the official substring exact match.

## Gates

| Gate | Pass |
|---|---|
| N1 | the check fixes multi-hop: mean over sizes of CN − CH on `mh` ≥ +10 pp |
| N2 | it does not break single-hop: mean of CN − CH on `sh` ≥ −2 pp |

## Also reported

- How often the check changed a link.
- How often the gold answer was shown at some step, now counting the
  neighbour candidates as well.
- Accuracy per size.
- Cost: own cache shared with E52, hard stop at **$5** in total.
