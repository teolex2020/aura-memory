---
title: "I Tried to Teach AI Memory What Matters. 10 Experiments Later, Most Clever Ideas Lost"
published: false
description: "Raw words beat summaries, time-based forgetting is the worst rule, agents' own test results predict nothing, and the one learned signal that worked needs a human. What three months of Aura Memory experiments showed."
tags: ai, machinelearning, rust, opensource
---

In July I wrote that agents need *governed memory*: memory with its own lifecycle that decays, gets promoted, consolidates and keeps provenance. Since then I have run ten experiments on public benchmarks and on my own real conversations, trying to make [Aura Memory](https://github.com/teolex2020/aura-memory) decide for itself what is worth keeping.

Some of what I believed in July turned out to be wrong. This post is the honest version.

Every experiment had its protocol and pass/fail thresholds written down and committed **before** the run. Runs that missed their threshold are reported as misses.

## 1. Keep the user's words. Do not summarize them.

The first question was what to store from a conversation at all. I used LongMemEval (120 questions about long chat histories), with the same reader and judge for every arm:

| Stored | Correct answers | Share of the text |
|---|---|---|
| nothing | 9% | 0% |
| the user's own messages, verbatim | **79%** | 12% |
| everything | 85% | 100% |
| an LLM summary per session | **25%** | 3% |
| user messages + summaries | 75% | 15% |

The user's words carry almost all the value at an eighth of the size. Nearly the whole gap to "everything" is one question type, "what did the assistant tell me?", which by design is not in the user's words.

Summaries were a disaster: they keep the topic and drop the facts. Worse, half of them described things the assistant "recommended", although the summarizer was only shown the user's messages. Added on top of the raw words, they *hurt*, because they push real messages out of the top results.

## 2. Real conversations: half of what people say is durable

Benchmarks are built from questions about the past, so they cannot tell you whether real conversations contain anything worth keeping. I labelled all 319 of my own messages to coding assistants from one week:

- **45%** carry something durable: facts about my setup (64), preferences (34), decisions with reasons (30), corrections (14).
- **12 times** in one week I repeated something the model had already lost (a new session or a context reset). **5** of those repeats crossed projects.

So conversation memory is worth it. But only "corrections" would have been far too narrow, and memory has to be shared across projects and tools, not walled per project.

## 3. Can memory learn what matters? Three dead ends and one door

Under a fixed space budget, memory has to forget. I streamed long conversations (LoCoMo) into a memory that could keep only 25% of the turns, and asked questions along the way:

| Forgetting rule | Later questions answered |
|---|---|
| no forgetting (reference) | 65.0% |
| decay over time, refreshed on use | 45.0% |
| forget the oldest | 44.0% |
| forget what is retrieved least | **34.5%** |

**Dead end 1: access counts.** "Promote what gets retrieved often" sounds sensible, and Aura did it. It was the worst rule by 10 points. Often-retrieved records are not useful ones; they are just similar to many questions. I removed it from the app.

**Dead end 2: crediting the record that helped.** After each answer I removed each cited record and asked again; if the answer broke, that record earned credit. The result was +1.5 points, which is noise. A record that helped once is rarely needed again, because the next question is about something else.

**The door: learn connections, not records.** Instead of crediting individual records, I trained a tiny network (66k weights, seconds on a CPU) on those consequence labels from 5 conversations, then let it decide what to forget in 5 *other* conversations with other people:

- **+16 points** over time-based decay;
- **+13.5 points** on average across 6 different train/test splits, better in all 6;
- **on LongMemEval (user and assistant), trained only on LoCoMo:** 45% vs 32% for time-based forgetting.

So "what is worth remembering" *is* learnable from consequences, without human labels.

## 4. ...but value is not length, and not surprise

Two findings kept this honest.

**Length is a fake signal.** On LoCoMo, simply keeping longer messages got most of the network's gain. On user–assistant data, the same rule kept 98% assistant turns and 5% of what was actually needed. Long is not valuable; long is just *more words*.

**Surprise is not value either.** I tested the most "mathematical" definition I could think of: how unpredictable a message is to a local language model (surprisal). It predicted almost nothing (AUC 0.55 on benchmark outcomes, 0.41 on my own messages). Unusual words, names and typos surprise a model, but they do not make a message important. My genuinely important messages were written in plain language.

What did add over length was *meaning*: a model judging "does this state a decision, plan, preference or fact about the person?" On user–assistant data, the network that sees content (embeddings) kept 45% of the needed messages, against 6% for the same network fed only structure.

The best definition I have is the decision-theoretic one, the value of information. A memory is worth what the future answer gains from having it. You can compute that only from consequences, and you can only *estimate* it from meaning.

## 5. Where do real consequences come from? Not from the agent

To learn from consequences in real life, there is no gold answer. The natural candidate is what a coding agent sees: exit codes, whether its tests passed, whether it finished.

I checked that on 67,000 public OpenHands trajectories, against whether the task was *really* solved (hidden tests):

| Signal the agent can see | Predicts real success (AUC) |
|---|---|
| exit codes of its commands | 0.51–0.53 |
| its own last test run passed | 0.52 |
| all signals together | 0.66 |

"Tests passed and the agent finished" was right 52% of the time, against a 48% base rate. Agents write tests that their own patch passes. **Real outcome signals have to come from people:** corrections, having to repeat yourself, and whether the change survived to a commit.

## 6. Two smaller lessons

- **Stale facts:** when an old fact and a newer one conflict, a rule that keeps only the newer of two near-duplicates changed nothing on MemoryAgentBench. Simply showing the model *when* each fact was written already got single-hop conflicts to 75–92%. Multi-hop conflicts (7–16%) are unsolved by everyone.
- **A "control facts" checker:** an LLM checker that flags answers going against facts the user marked as must-hold caught 84% of violations on PrefEval, with 4% false alarms. That is good, but below the 90% I required. Meanwhile, simply *delivering* the preference to the model cut violations from 90% to 0.6%. Delivery is the main job; checking is a second line.

## What changed in Aura

- **1.60.1 (out now):** a data-loss fix. Consolidation merged facts that differed only by a number, an identifier or a "not" (40 distinct facts became 1 in one test). Merges now require identical words in any language. If you use 1.60.0 and call `run_maintenance()`, please upgrade: `pip install -U aura-memory`.
- **Next (1.61):**
  - `recall()` keeps first-hand memory apart from outside text by default;
  - security profiles;
  - resistance to one source repeating a claim many times;
  - model-written memories no longer get top trust;
  - a loopback MCP server with a bridge, so many AI tools share one memory;
  - per-app privacy scopes.
- **For people, not just developers:** a [Windows app](https://www.aurasdk.dev/desktop) that gives Claude Code, Cursor, Codex and other tools one shared memory, built on what is above: verbatim words, source labels, no summaries, and no pretending it knows what matters.

## What I'd say now, instead of July

Memory does not need a smarter write-time brain. It needs three things:

- to keep what you said, as you said it;
- to deliver it at the right moment, labelled with where it came from;
- to learn what matters only from real consequences, which come from people.

The rest was mostly me building machinery that the experiments could not justify.

I'd like to hear from anyone working on outcome signals for memory. That is the open problem.
