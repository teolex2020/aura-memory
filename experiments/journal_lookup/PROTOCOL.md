# E56: user words in memory, AI replies looked up in the journal only when asked about them

Status: **frozen 2026-10-07**, before any model call. **Test only**: the
owner asked for no integration.

## Question

E35 (LongMemEval-S, 120 questions) measured three things:
- the user's words alone (U): 79.2%;
- the whole conversation (F): 85.0%;
- nothing (N): 9.2%.

The whole gap is one question type, "what did the assistant say"
(`single-session-assistant`): U 40%, F 95%. On other types F is no better
and sometimes worse:
- temporal reasoning: U 90%, F 75%;
- knowledge update: U 100%, F 90%.

The owner's memory keeps only the user's words, and the app keeps the AI's
replies in its journal. Can a lookup in the journal, made only when a
question is about what the AI said, recover F's accuracy on those
questions without F's losses elsewhere?

## Data and reuse

Exactly E35:
- the same 120 questions (E19 selection);
- the same reader (`gemini-3.1-flash-lite`, system
  `You are a helpful assistant.`, E35's reader prompt);
- the same official LongMemEval judge;
- E35's retrieved user-word records (`../capture_value/retrieved.jsonl`,
  arm U).

N, U and F results are reused from E35's `rows.jsonl` with the same model,
prompts and cache. E56 has its own cache and budget. E19 and E35 code
import `mem0`, which is no longer installed. It is stubbed: its classes are
never used in these phases.

## The journal

For each question, the journal is every assistant turn of its haystack
sessions, with session dates. A journal search returns the top 5 assistant
turns by bge-m3 cosine to the question, using E19's embedding cache and
Ollama for any miss.

The journal block is appended after the user-word memories:

```
Earlier assistant replies (from the conversation journal: what the AI said then, not established facts):

[Session time: <date>]
Assistant: <turn>
...
```

## Arms

- **JR, routed:**
  - The reader model first answers one yes/no question:
    `Does this question ask about something the assistant said, suggested,
    explained or did in an earlier conversation, rather than about the user
    or the world? Answer yes or no only.`
  - On yes, the journal block is added to U's context; on no, the context
    is U's alone.
- **JA, always:** U's context plus the journal block for every question.

No word lists anywhere: routing is a model judgment.

## Gates

| Gate | Pass |
|---|---|
| J1 | overall: acc(JR) ≥ acc(F) − 2 pp (≥ 83.0%) |
| J2 | AI-reply questions: acc(JR) on `single-session-assistant` ≥ 80% (U 40%, F 95%) |
| J3 | no harm elsewhere: acc(JR) on the other five types ≥ acc(U) on them − 2 pp |

## Also reported

- JA accuracy, overall and per type.
- How the router decided against question type: recall on
  `single-session-assistant` and the yes rate on other types.
- Memory size stays U's: the journal is not memory.
- Cost: hard stop at **$3**.
