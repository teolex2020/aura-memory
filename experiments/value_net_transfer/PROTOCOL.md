# E40: does the value net transfer from LoCoMo to LongMemEval?

Status: **frozen 2026-10-02**, before E39's results are seen and before any
E40 run.

## Question

E38 trained and tested on LoCoMo, which is chat between two people. Aura's
product stores conversations between a user and an AI assistant, where the
assistant's turns are long and mostly not worth keeping (E35). Does a net
trained only on LoCoMo outcomes still choose well what to forget there?

## Data

LongMemEval-S, E19's 120-question selection (seed 19, 20 per type,
`longmemeval_s.json` SHA-256 `08d8dad4…7894`).

For each question, its haystack is replayed session by session in file order.
Each turn is one record, `[session date] User: …` or `[session date]
Assistant: …`. The question is asked once, after the last session, with its
`question_date`. Capacity is 25% of the haystack's turns. Evidence means the
turns marked `has_answer`.

## Arms

| Arm | Score |
|---|---|
| U | no eviction (reference) |
| R | recency (session index) |
| D | decay with refresh, as in E37. Accesses only happen at the single final question, so this is effectively recency with ties |
| L | length of the turn text |
| **V** | E38's network, retrained with E38's frozen settings on consequence labels from **all 10** LoCoMo conversations (E38 plus E39 labels), seed 38 |
| S | the same with the 4 structural numbers only (no embedding) |

- **Features are as in E38.** The text after the role prefix is the raw text.
  The photo flag is always 0. Position is relative within the session.
- **Embeddings:** bge-m3 of the prefixed record text, as in LoCoMo, computed
  locally with Ollama. Retrieval uses the same embeddings, top 10.
- **Reader and judge:** as in E37. The judge uses the official LongMemEval
  template for each question type.

## Metrics

- **Primary:** accuracy on the 120 questions.
- **Also reported:**
  - per question type, especially `single-session-assistant`, where the
    answer is in an assistant turn;
  - the share of evidence turns kept;
  - the share of assistant turns among kept records;
  - cost.

## Gates

| Gate | Pass |
|---|---|
| T0 | forgetting matters: U ≥ R + 10 pp |
| T1 | transfer beats the fixed rule: V ≥ D + 5 pp |
| T2 | it beats "longer is better": V ≥ L + 3 pp |

## Decision rule

- **T1 and T2 pass:** a LoCoMo-trained net transfers to user–assistant memory.
  That supports a pretrained core net adapted on the user's own outcomes.
- **T1 passes, T2 fails:** content-based forgetting transfers, but length does
  as well.
- **T1 fails:** the net does not transfer. It would need training on
  user–assistant data before any product use.

## Limits stated in advance

- **One question per haystack.** Memory is scored only at the end, so there
  is no stream of experience inside a haystack.
- **Long assistant turns.** They may favour L, and V too, if the net
  learned "long = useful".
- **One seed.**

## Freeze record

- `run.py` sha256 `d2ca0973437276ddd4a20bf52790adacb71aa0e83737e5e88a19404cc1e6c3ea`.
- E40 has its own API cap: $3 on top of what E37–E39 spent.
