---
title: "Most Messages Don't Need Memory. The Ones That Do Need More Than Retrieval"
published: false
description: "Seven experiments on whether LLMs still need memory when context windows are huge: how often memory is needed, what a long context costs, where both fail, and why I could not find a cheap way to decide when to think harder."
tags: ai, llm, machinelearning, opensource
---

Two camps keep talking past each other. One says context windows are now so large that memory is a solved problem: put the history in the prompt. The other says every agent needs a memory layer.

I build a memory layer ([Aura Memory](https://github.com/teolex2020/aura-memory)), so I had a reason to want the second camp to be right. Instead of arguing, I spent a week measuring. I ran seven experiments on public benchmarks and on my own working sessions. Every protocol, with its pass/fail thresholds, was committed **before** the run. Runs that missed are reported as misses. Total API cost: about $6.60.

Short version: both camps are right, about different things.

## 1. How often does a message need memory at all?

I took my own real sessions with coding agents over four days: 163 messages in 8 sessions. A local model (`qwen3:4b` in Ollama; nothing left the machine) judged each message: does answering it need something from an *earlier, separate* conversation?

- **10.4%** of messages needed the past (17 of 163). The rest were about the current conversation or task.
- A short **profile** built from earlier durable statements (decisions, facts, preferences, plans; median 285 characters) covered **71%** of those needs.
- Retrieval similarity could **not** tell which messages needed memory: AUC **0.52**, a coin flip. When every message is about the same project, something similar is always found.

So for everyday work, most messages need no memory at all. A small profile at the start of a session handles most of the rest.

## 2. When memory is needed, it matters a lot. When it isn't, it barely hurts

Same reader model (`gemini-3.1-flash-lite`), same judge:

| | No memory | With memory |
|---|---|---|
| LongMemEval (memory needed), 120 questions | 9.2% | **79.2%** |
| TruthfulQA (memory not needed, 10 unrelated memories added) | 80.8% | 80.0% |

Models mostly ignore irrelevant memories. Adding memory when it isn't needed costs tokens, not accuracy.

## 3. Agents change the economics

I counted model calls in 2,000 real OpenHands trajectories (SWE-rebench). One human message leads to a median of **60 model calls** (p90: 96).

That decides *where* memory goes. Injected once per user message, it costs one lookup (~0.2 s). Injected on every model call (a proxy does this), it costs 60 lookups and ~60k extra input tokens for the same information, which the agent already carries in its conversation.

## 4. Long context vs retrieval

Now the main question. On LongMemEval (60 questions, ~115k tokens of history each):

| The model gets | Correct | Input per question |
|---|---|---|
| nothing | 10.0% | — |
| the **whole history** in context | 78.3% | ~109,000 tokens |
| 10 retrieved records (the user's own words) | **81.7%** | ~730 tokens |
| 10 retrieved records (both sides of the chat) | 86.7% | — |

For lookups, a long context is about as good as retrieval, at **~150 times the input**. It wins on one question type, "what did the assistant tell me?" (100% vs 50%), because the assistant's turns are in the history and not in a store of the user's words. On updated facts and time questions it is 20 points *worse* than retrieval: among 115k tokens the model more often picks a stale fact.

Then I gave it facts that change over time. MemoryAgentBench FactConsolidation is a synthetic set where facts get overwritten ("the CEO of X is now Y"). Multi-hop questions chain several such facts:

| | Whole pool in context | Retrieval | Step-by-step chain with a newest-fact check |
|---|---|---|---|
| single-hop | 90.7% | 82.7% | 89.3% |
| multi-hop | 14.7% | 13.3% | **44.0%** |

Neither a long context nor retrieval can reason over facts that changed. What worked was **processing**: answer one fact per step, and at each step check whether a newer record overrides the one just used.

So the useful framing is not "memory vs context". Memory matters as **analysis**, not as storage, and only when you are actually analysing something.

## 5. When should the processor switch on?

The chain costs ~3 model calls instead of 1, so you want it only when it helps. With hindsight ("oracle"), it was needed on **23.5%** of FactConsolidation questions. Running it only there gives 69.9% at 1.6 calls per question; running it always gives 68.1% at 3.2.

I tried three cheap ways to find those questions:

| Router | What went wrong |
|---|---|
| local 4B model, reading the question | fired on 46% of my real messages, *equally often* whether they needed the past or not (47% vs 46%) |
| local 4B model, question + retrieved memories | fired on 93% of my messages (every project memory looks like "a version of the same fact"), and on only 10% of FactConsolidation, where versions really exist |
| the reader flags "needs analysis" itself | kept 95% of the gain, but fired on 82% / 50% of questions and cost more than always-on |

The last one had a side effect: asking the reader to judge whether it needed help made its own answers **worse**, 81.7% → 71.7% on LongMemEval.

## 6. Then just run it always?

No. On plain lookups (LongMemEval, 120 questions), adding the chain's notes to the retrieved memories gave **76.7% vs 79.2%** without them: 6 answers fixed, 9 broken. It also added 2.4 calls and 1.7 s per question.

The worst breakage came from the very rule that makes the chain work. Asked *"What was my **previous** personal best?"*, the chain applied "newer overrides older" and returned the newest one.

## 7. Then do the analysis while idle

Humans consolidate memories in sleep, so I tried that. An idle pass links versions of facts ahead of time, and the answer stays one cheap call.

Linking alone did nothing (82.7% vs 83.3% on single-hop). The diagnosis surprised me. In **all 50** failures, the newer fact was **already among the retrieved records**. The model still picked the old one, or its own world knowledge. Asked for the official language of the United States, it answered "American English" while the newer fact in memory said "German".

What was missing was not the fact but an explicit signal. Marking the older record `[outdated: updated by fact #N]` raised single-hop to **94.7%** at one call, against 96.7% for the chain at ~3 calls. I added that arm after the diagnosis, so I re-ran it unchanged on data it had never seen:

| | Without marks | With marks |
|---|---|---|
| FactConsolidation, 262k-token pool | 80% | 87% (chain: 95%) |
| LongMemEval, knowledge-update (40 new questions) | 85% | **90%** |
| LongMemEval, temporal reasoning (40 new questions) | 82.5% | **77.5%** |

Half a confirmation. On real conversations the idle pass linked far too much: 16,254 "updates" across 19,360 records. "I started reading the book on Jan 10" got marked outdated by "I finished it on Jan 31", and then the model could not count the days. A real replacement (alarm 8:00 → 7:30) is not the same as an event that continues another, and my linker could not tell them apart. Not ready.

## 8. The bug that almost fooled me

Before all this, I audited my own memory store: 298 records, **one** memory tool call in 8,239 agent hook events. I wrote it down as a finding: *models don't call memory tools on their own*.

Then, while looking into a connection timeout, I read the MCP client logs. Since October 2, Claude Code had been sending a newer protocol's `server/discover` probe before `initialize`. My stdio bridge, built on rmcp, could not parse it, logged a serde error, stopped reading, and hung until the 30-second timeout. For six days the memory tools were missing from **every** Claude Code session. Hooks kept working, so everything looked alive.

The fix is a few lines (answer unknown requests with JSON-RPC `-32601`) and shipped in 1.61.1. The lesson was bigger: before drawing conclusions about model behaviour, check the pipe. My "finding" is now a hypothesis to test again.

## What I take from this

| Level | What | When |
|---|---|---|
| 0 | the conversation itself | always, free |
| 1 | a small profile of durable facts and decisions | once per session |
| 2 | retrieval, no similarity gate | once per user message, never per agent step |
| 3 | analysis (chains, newest-fact checks) | only when someone actually asks for analysis |

Things I would not build yet: an always-on processor, a cheap router that guesses when to think harder, and idle "sleep" marks. The last one is the most promising. It needs narrower linking (one property, new value) and a softer mark ("a newer value exists") than "outdated".

## Limits

- One small model (`gemini-3.1-flash-lite`) for almost everything.
- FactConsolidation is synthetic, so it tests the mechanism, not the real world.
- 60–120 LongMemEval questions per run: differences of 2–3 points are noise.
- The real-session numbers are one person over four days, labelled by a local 4B judge (17 "needs the past" cases).
- The "outdated marks" result came from an arm added after diagnosis. Its fresh-data rerun is the number to trust.

Protocols, code and results for every experiment are in the repo under [`experiments/`](https://github.com/teolex2020/aura-memory/tree/main/experiments) (E57–E63). Benchmarks: LongMemEval (MIT), MemoryAgentBench (MIT), TruthfulQA, and SWE-rebench OpenHands trajectories.

If you have measured any of this on a bigger model, I would like to know whether the numbers hold.
