# E21: how memory is framed for the model — preregistered protocol

Status: **frozen 2026-09-29** (amendment D1 at the end), before any run.

## Why

In E20 every system scored 35–45% on preference questions. Diagnosis on the
cached E20 answers (before this protocol): most wrong answers in every arm
and type are refusals ("I do not have that information"), usually with the
evidence retrieved — preference: 12 of 13 wrong answers for Aura-capture were
refusals, 9 of them with the evidence in the top 10. The reader was told to
answer only from the memories and not to guess, so asked for a
recommendation it says the memories contain none, instead of using what it
knows about the user.

A client's system prompt is not Aura's to write. What Aura controls is how
recalled memory is presented (the `recall()` context and the MCP
instructions). E21 tests whether a short framing line from Aura makes the
model use memory for personal advice, and whether it makes the model invent
facts elsewhere.

## Setup

Same 120 questions, retrieval (E20 `retrieved.jsonl`), context format, reader
and judge (`gemini-3.8-flash`, official judge prompts) as E20. Arms M (mem0)
and A-cap (Aura capture). Conditions:

| Condition | Reader system prompt | Memory block |
|---|---|---|
| R0 (E20, cached) | aegis: answer only from the memories, do not guess | `Retrieved memories:` + turns |
| F0 | neutral: `You are a helpful assistant.` | `Retrieved memories:` + turns |
| F1 | neutral: `You are a helpful assistant.` | `Retrieved memories:` + **framing line** + turns |

Framing line (fixed now, English, one paragraph):

> These are excerpts from your past conversations with this user. Use them
> to answer questions about what the user said or did, and to tailor advice
> and recommendations to the user's preferences, plans and situation; for
> advice, combine them with your general knowledge. Say you do not know only
> when the question asks for a specific fact that is not in them.

User message otherwise as E20 (`Current date`, memories, `Question`).

## Gates (A-cap)

| Gate | Pass |
|---|---|
| P1 | preference accuracy: F1 ≥ R0 + 25 pp |
| P2 | accuracy on the other five types: F1 ≥ R0 − 3 pp (no invented facts) |
| P3 | preference accuracy: F1 ≥ F0 + 10 pp (the framing adds more than dropping the strict prompt) |

Reported: every arm × condition × type; refusal rate (same regex as the
diagnosis); M under F1 (the framing is a property of the context, not of
Aura's retrieval).

## Decision rule

- **P1, P2, P3 pass:** the framing line goes into Aura's `recall()` context and
  the MCP server instructions (separate change with tests).
- **P1, P2 pass, P3 fails:** the gain comes from not forbidding the model to
  use its knowledge; document that in the integration guide, no header.
- **P2 fails:** the framing makes the model invent facts; do not ship it.

Failures are reported, not retried away.

## Amendment D1 (2026-09-29, before any run)

- `run.py` sha256 `24a5df2de6f08c76c41ef2e2a81b15631786326f42db434eafe277c3ea3ef7ac`; E20 code and cache at `9edd6e2`.
- The diagnosis in "Why" used only E20's cached answers; the framing line was written
  from it before any F0/F1 call.
