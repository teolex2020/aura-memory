# E22b: always-on identity block, powered re-test — preregistered protocol

Date frozen: 2026-09-29, before the dataset existed.

## Question

E22: an always-on block of first-hand IDENTITY records (K) raised inference
answers 52% → 75% but control answers fell 100% → 93.8% (2 of 32: one
scoring artifact from Ukrainian inflection, one digit copy error), failing
J3. With more control questions and repeated runs, does K hurt ordinary
answers, or was that noise?

## Arms (unchanged from E22, same runner code)

- **B** — `recall(question)`.
- **K** — B plus the always-on first-hand identity block (25% of budget).
- **KR** — K plus the reasoning-hook block (reported only).

Each arm is answered **3 times** per question (`qwen3:4b-instruct`,
temperature 0; E14b showed identical contexts can still get different
answers). Rates are averaged over the 3 runs.

## Data (new author, no repository access, hashed before reading)

`data/personas.jsonl`: 8 personas (4 uk, 4 en), same schema as E22, but
**6 inference and 10 control** questions each (48 + 80). Expected strings
must use stems that match every inflected form of names and words.

## Gates (K, qwen3:4b-instruct)

| Gate | Pass |
|---|---|
| J1 | identity presence ≥ B + 30 pp |
| J2 | inference correct (mean of 3 runs) ≥ B + 20 pp |
| J3 | control correct (mean of 3 runs) ≥ B − 5 pp |
| J4 | untrusted identity claims in the block: 0 |

K is implemented in the core only if J1–J4 pass. Reported: run-to-run
spread per arm, KR, answers per language.

## Amendment D1 (2026-09-29, before any run)

`data/personas.jsonl` sha256 `aea88fddd5e42da293fdb4baecab039810b5aa532d002637a81143f9dd402ee9` (8 personas). Automatic check issues: []. The author notes some short or generic expected strings (e.g. r5q5 "fear") and deliberately planted lookalike numbers in control records.

## Amendment D2 (2026-09-29, after the gated run, before the fix run)

The gated run passed J1–J4. Porting the block to the core showed that the
IDENTITY level also held ordinary notes promoted there by write-time
novelty ("surprise") promotion (up to 40 first-hand IDENTITY records per
persona instead of 15), in the prototype as well. That promotion bypassed
the identity-evidence threshold the governed maintenance promotion
enforces, so the core fix caps novelty promotion below IDENTITY. Because
this changes what the block contains (and possibly B's ranking), the same
arms are re-run once on the same data with the fixed core build ("fix
run"), with the same gates. The fixed block ships only if the fix run also
passes J1–J4. `core_check.py` (deterministic, before the fix): needed fact
present 48/48, untrusted in first-hand part 0, core block equal to the
prototype block in 102/128 cases (all differences: the core block is a
subset, from counting the bullet as a token).

## Note (2026-09-29): renumbered

First recorded as E16/E16b; renumbered to E22/E22b because a parallel
session had already used E16 (`experiments/auto_capture`). Commit messages
keep the old number.
