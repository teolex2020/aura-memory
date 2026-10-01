# E32: memory spaces from provenance — hard walls, soft preference, or none?

Frozen before data. Measurement only; any core change waits for the result.

## Question

The owner proposed keeping memory by area (marketing, maths, biology…) to
make search easier. Three things are ruled out by the design:

- assigning areas by content needs a model or word lists;
- word lists are not allowed;
- a misfiled fact behind a hard wall is lost.

So we test spaces taken from **where a memory came from**: the app, the
project folder, the imported file. The questions:

- Does preferring the current space improve recall where the same words
  mean different things in different spaces?
- Does it cost the questions that need a memory from another space, or a
  fact about the user?

## Data (independent author, hashed before reading)

An author with no access to this repository writes 6 personas (3 uk, 3 en).
Each persona has:

- **4 spaces.** For example two work projects, personal, and studies. Each
  space is defined by provenance (app and project, or imported file), not by
  topic words.
- **25 memories per space.**
  - At least 6 per space collide with another space: same key words,
    different facts. Examples: "deploy" in two projects with different
    targets, "budget" at work and at home, "the team" in two projects.
- **8 identity facts** about the person, said first-hand. They belong to no
  space.
- **40 questions**, each with the space it is asked from and the gold
  memory id(s):
  - 20 **in-space**: the gold is in the current space, and a colliding
    memory exists elsewhere;
  - 10 **cross-space**: the gold is in another space;
  - 10 **identity**: the gold is an identity fact.

## Arms

Same stores and queries in every arm; one store per persona per arm.

- **G (global):** today's recall over everything.
- **H (hard):** each space in its own namespace and identity facts in a
  shared one; recall searches only the current space plus identity.
- **S (soft):** global retrieval, a pool of 40 by `recall_structured`, then
  re-ranking:
  - score × (1 + β) when the record's space is the current one,
    β = 0.5 (primary);
  - identity facts are never down-ranked.
  - Implemented in the experiment, not in the core.
  - Also reported: S1, with β = 1.0.

Embeddings: LEX (no embedding function, the app today) is primary. EMB
(bge-m3) is reported as well.

## Metrics

- hit@5: a gold memory among the top 5 records.
- For in-space questions, also **intrusion**: the share of the top-5 that
  are colliding memories from another space.

## Gates (S is worth building only if all hold, on LEX)

1. In-space hit@5: S ≥ G + 5 pp.
2. Cross-space hit@5: S ≥ G − 3 pp.
3. Identity hit@5: S ≥ G − 2 pp.

H is expected to fail gate 2. It is measured to show what hard walls cost.

## Limits stated in advance

- Synthetic data from one author.
- Retrieval only.
- Spaces are given as metadata. Real provenance capture (for example, the
  bridge passing the project folder) is not tested here.
