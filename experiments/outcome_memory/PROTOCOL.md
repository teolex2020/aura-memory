# E37: can memory learn from consequences what to keep?

Status: **frozen 2026-10-02**, before any run.

## Question

Every memory with limited room has to forget something. Today's rules are
fixed: the oldest goes first, or what is rarely retrieved, or what decays
with time. The owner's question is whether memory can instead learn **from
experience** what is worth keeping: a record that helped an answer is kept,
and a record that never helps fades.

This is the lived-data follow-up of `causal_task_utility_eval` (2026-09-15).
In simulation that experiment found +30 to +37 pp from outcome receipts, and
+0 from mere access.

## Data

LoCoMo (`locomo10.json`, SHA-256 `79fa87e9…98ff4`, CC BY-NC, kept local).
It has 10 long conversations: 19–32 sessions and 369–689 turns each.

- **Questions:** categories 1–4 (multi-hop, temporal, open-domain,
  single-hop). Category 5 (adversarial, no answer) is excluded, as are
  questions whose evidence ids do not parse.
- **Sample:** 40 questions per conversation, `random.Random(37)`, 400 in all.
- **When a question is asked:** after a session chosen uniformly from
  [session of its last evidence turn, last session], with the same seed.
  Questions asked after the same session keep dataset order.

## Stream

For each conversation, sessions arrive in order. Each turn becomes one
record, `[date] Speaker: text`; a shared photo's caption is appended. After
each session:

1. The policy evicts records until the store is within capacity.
2. The questions scheduled for that session are asked.

**Capacity:** 25% of the conversation's turns, rounded. This is binding: most
of the conversation must be forgotten.

**Retrieval** is the same for every arm: bge-m3 cosine similarity (local
Ollama, cached) between the question and the kept records, top 10. A record
counts as accessed when it is in the top 10.

## Arms

`t` is the session index. Each arm evicts its lowest score first; ties go to
the oldest.

| Arm | Score |
|---|---|
| **U** | no eviction (unlimited reference, not a competitor) |
| **R** | recency: `t_created` |
| **B** | access count: number of times retrieved |
| **D** | decay with refresh (MemoryBank): `exp(-(t - t_last_access) / S)`, where `S = 1 + accesses` and `t_last_access` is `t_created` until first access |
| **C** | D + outcome credit: `D + credits`, where `credits` counts the times removing the record broke a correct answer |

**Outcome credit in C:**

- The reader answers from the top 10 and names the numbers of the records it
  used.
- If the judge marks the answer correct, each cited record (up to 3) is
  removed in turn and the question is answered again.
- If that answer is judged wrong, the record gets +1 credit.

No human labels are used: the judge and the dataset's gold answers stand in
for "the task succeeded".

## Models

`gemini-3.1-flash-lite`, temperature 0, for both reader and judge.

- **Reader:** E20's reader format (memories tagged with their dates) plus one
  instruction. The last line must be `USED: <numbers>`, or `USED: none`.
- **Judge:** the official LongMemEval yes/no prompt, as in E20 and E35. It
  uses the temporal-reasoning template for category 2 and the
  single-session-user template otherwise.
- **Budget:** about $3. The run stops at $4.5.

## Metrics

- **Primary:** accuracy on the **second half** of each conversation's
  questions in stream order, 200 questions. That is where earlier experience
  can matter.
- **Also reported:**
  - accuracy on all 400 questions and per category;
  - the share of evidence turns still kept when their question is asked;
  - how many credits C gave;
  - cost.

## Gates

| Gate | Pass |
|---|---|
| G0 | forgetting matters: acc(U) ≥ acc(R) + 10 pp on the second half |
| G1 | learning from outcomes adds value: acc(C) ≥ acc(D) + 5 pp |
| G2 | consequence beats mere access: acc(C) > acc(B) |

## Decision rule

- **G0 fails:** capacity does not bind; nothing is decided.
- **G1 and G2 pass:** outcome learning is worth building. The next question
  is where real outcome signals come from in daily use, such as tool exit
  codes or a user restating or correcting something (E38).
- **Otherwise:** outcome credit in this form does not justify itself; report
  why.

## Limits stated in advance

- **The outcome is a judge against a gold answer.** Real life has no gold
  answer; this is the best case for an outcome signal.
- **Credit assignment.** Removing one record at a time misses redundant
  records: when two records both hold a fact, neither gets credit.
- **LoCoMo is synthetic dialogue between two people,** not a user and an
  assistant.
- **Each question is asked once,** so later questions benefit from earlier
  credit only when they need the same records.

## Freeze record

- `run.py` sha256 `80875fe6dea1235b0b7e37a376735dfc755ceb7ef953ceb91a6e1fc60fe341a0`. Plain Python 3.13, no packages (the E35 venv was cleared with the temp folder).
- 400 questions (categories 1/2/3/4: 68/75/26/231); capacities 25% of turns (92–172 records).
