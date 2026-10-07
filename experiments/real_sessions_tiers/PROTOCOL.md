# E58: levels 1 and 2 on the owner's real sessions (local only)

Status: **frozen 2026-10-07**, before any measurement. **Test only.**

**Privacy.** The owner's data stays on this machine. There are no external
API calls. Only a local model (Ollama `qwen3:4b-instruct`) and local
embeddings (bge-m3) are used. Outputs go to `private/` (gitignored). Only
this protocol, the code and aggregate results are committed.

## Question

E57 measured cost and benefit on public data, where the share of messages
that need memory was a free parameter (5–50%). How often do the owner's
real messages actually need something from **earlier, separate**
conversations? Then three things:
- does the cheap top-1 score signal (level 2) catch those messages;
- what does a recalled item contribute;
- how much would a session profile built in advance (level 1) cover?

## Data

The Aura journal, `%APPDATA%\Aura\journal\*.jsonl`, 2026-10-04 to
2026-10-07: every `UserPromptSubmit` event, 311 events in 8 sessions.

Each prompt is split exactly as `python/aura/capture.py:split_prompt` does
(app notices dropped, pasted text removed, `[…]` kept). Prompts left with
no own words are skipped.

**Levels.**
- **Level 0 (in context):** earlier prompts of the same session.
- **Level 2 (long-term memory):** prompts of **other sessions** made before
  this one.

## Signal (level 2)

Prompts are taken in time order into one Aura store (`aura`, this branch),
with the bge-m3 embedding function on local Ollama, channel
`user-<client>`. For each prompt:
1. run `recall_structured(prompt, top_k=15)`;
2. drop hits from the same session;
3. keep the top 3 remaining and the top-1 score.

Then store the prompt.

## Local judge (Ollama `qwen3:4b-instruct`, temperature 0, yes/no)

| Code | Question |
|---|---|
| J1 `needs_past` | Given the message and up to 3 previous messages of the **same** conversation: does answering it need information from **earlier, separate** conversations (past decisions, facts about the user's projects, things discussed days ago), not present here? |
| J2 `useful` | Would any of the 3 recalled memories (from earlier conversations) help respond to the message? Asked only when level 2 returns something. |
| J3 `durable` | Is this message a lasting fact, preference, decision or plan worth remembering beyond this conversation, as opposed to a one-off command? Asked for every prompt; used to build the profile. |
| J4 `covered` | For J1 = yes: does the session profile contain the earlier information the message needs? |

## Profile (level 1)

At each session's first prompt, the profile is the 15 most recent J3 =
yes messages from earlier sessions, in time order, each cut to 300
characters.

## Metrics

- **p_real:** the share of prompts with J1 = yes.
- **Level 2:**
  - ROC AUC of the top-1 score against J1, and against J2;
  - injection rate and the share of injections judged useful, at
    τ = 0.52, 0.55 and 0.57 (E57's range);
  - recall latency on the real store.
- **Level 1:**
  - J4 coverage of J1 = yes prompts;
  - profile size in characters.
- **Combined:** the share of J1 = yes prompts helped by level 1 or level 2
  (J4 = yes, or J2 = yes with the score at or above τ = 0.55).

## Gates (inform the design, not ship decisions)

| Gate | Pass |
|---|---|
| R1 | the signal finds what is needed: AUC(top-1 vs J1) ≥ 0.70 |
| R2 | injections are mostly useful: at τ = 0.55, ≥ 50% of injections J2 = yes |
| R3 | a profile carries weight: J4 coverage ≥ 30% of J1 = yes prompts |

## Known limits (stated in advance)

- One person.
- 4 days, dominated by one long session.
- A 4B local judge.
- The owner may spot-check judge labels in `private/` to estimate their
  error.
