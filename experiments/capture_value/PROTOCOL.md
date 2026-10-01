# E35: what is worth keeping from a conversation

Status: **frozen 2026-10-01**, before any summary, retrieval or answer.

## Question

The desktop app does not capture conversations yet. The owner asked whether
keeping conversations is worth the space, or whether only part of them
matters. Two candidate rules:

- **User words only.** Keep what the user said, verbatim, and drop the
  assistant's replies, which are most of the volume.
- **Session summary.** Keep an LLM summary per session, as the owner's agent
  Remy does (`E:\remy\app\src\remy\core\session_summary.py`).

Does either keep the answers while storing much less?

## Data

LongMemEval-S, E19's file and selection: `longmemeval_s.json`, SHA-256
`08d8dad4…7894`, `random.Random(19)`, 20 questions per type, 120 questions,
5,340 unique sessions.

## Arms

Each question gets fresh stores built from its haystack, in session order,
Domain level, no dedup, bge-m3 embeddings (E19's cache, local Ollama).

| Arm | What is stored |
|---|---|
| N | nothing; the reader gets no memories |
| U | user turns verbatim, `channel="user-claude-code"` |
| F | every turn: user turns as in U, assistant turns `channel="agent-claude-code"` (E19 A-cap) |
| S | one summary per session, `channel="agent-claude-code"` (model-written) |
| US | U plus S |

**Summaries are made exactly as in Remy:** the same prompt, verbatim. The
input is the session's user turns, formatted as `- User said: "…"`, and capped
at 16,000 characters (first 20% plus last 80%). The assistant's text is
dropped, as Remy does. A session with no user text gets no summary.

**Retrieval:** `recall_structured(question, top_k=10)`.

**Reader context:** E20's format, with each record labeled by session time and
speaker. Summaries are labeled `Session summary`.

## Models

`gemini-3.1-flash-lite` with temperature 0 for summaries, reader and judge.

- The reader runs with system prompt `You are a helpful assistant.` and E20's
  reader prompt. This is E21's F0 condition, the best one there.
- The judge uses the official LongMemEval prompts, as in E20.

Budget: about $2; the run stops at $4.5.

## Metrics

- **Primary:** answer accuracy (judge says yes), on all 120 questions and per
  question type.
- **Size:** records and characters stored per question (median), and bytes on
  disk.
- **Retrieval:**
  - `sess_any@10` for every memory arm (a record from an evidence session in
    the top 10);
  - `turn_any@10` for U and F.
- **Cost:** summary cost in dollars.

## Gates

| Gate | Pass |
|---|---|
| H0 | memory matters at all: acc(F) ≥ acc(N) + 20 pp |
| H1 | user words are enough: acc(U) ≥ acc(F) − 5 pp |
| H2 | user words are small: median chars(U) ≤ 50% of chars(F) |
| H3 | summaries are enough: acc(S) ≥ acc(F) − 5 pp |
| H4 | summaries add to user words: acc(US) ≥ acc(U) + 3 pp |

## Decision rule

- **H0 fails:** the setup cannot tell the arms apart; nothing is decided.
- **H1 and H2 pass:** desktop capture keeps user words only, verbatim. The
  short-term level with decay and promotion by use is a separate step, not
  tested here.
- **H1 fails:** report the question types it loses; the owner chooses
  between user words and the full conversation.
- **H3 passes:** summaries are a candidate for a smaller store. They still
  need a provenance test, because E16 showed that LLM extraction launders
  sources.
- **H3 fails:** no Remy-style summaries as the only memory.
- **H4 passes:** summaries on top of user words are a candidate.
- **H4 fails:** they are not added.

Failures are reported, not retried away.

## Expected weak spot, stated in advance

20 `single-session-assistant` questions ask about what the assistant said.
U and S cannot store that by design. They are reported separately and count
in the overall gates.

## Limits stated in advance

- **LongMemEval measures recall of past chats.** It does not measure whether
  the owner's real conversations hold anything worth keeping.
- **No usage signal.** Decay and promotion by use cannot be tested here.
- **One cheap model and one run per item.** Absolute accuracy is lower than in
  E20 (gemini-3.8-flash); only the gaps between arms are compared.
- **Size stats came first.** Before freezing, I computed the dataset's size
  statistics: user text is 12.6% of all characters and the summary input
  totals 7.2M characters. No summary, retrieval or answer was run.

## Freeze record

- `run.py` sha256 `818e3024dbf09ccc3645c02633bbba2a49ca791ecea0b82b49fa525ebe165fec`.
- Core: the E31 Python build, `_core` sha256 `940a338128f129154f4488098d94593508dbcd8766a42b0e3ea2b767a5684abd`.
- 120 questions, 5,339 sessions with user text.

## Amendment D1 (2026-10-01, after retrieval, before any answer; execution only)

`answer` failed while loading `retrieved.jsonl`. `str.splitlines()` also splits on Unicode line separators (for example U+2028), and some LongMemEval turns contain them, so one JSON line was cut. The three JSONL loaders now split on `\n` only. No arm, prompt, metric or gate changes. Retrieval rows and summaries are kept. `run.py` sha256 `12b8bb6355da80ce1f8ec0e95314396e2c4650f6675f406bf56b76733d0f7467`.
