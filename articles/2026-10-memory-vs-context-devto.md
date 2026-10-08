---
title: "AI Memory Isn't About Remembering. It's About Noticing What Changed"
published: false
description: "Does ChatGPT or Claude need to remember your past chats, or can it just reread everything? I tested it for a week. Mostly it needs no memory at all. When it does, it fails not because it forgot, but because it missed that something changed."
tags: ai, llm, machinelearning, opensource
---

When you talk to ChatGPT or Claude, should it remember your earlier conversations?

One camp says yes: without memory the AI meets you from scratch every time. The other says no: modern models can read hundreds of pages at once, so just give them the whole chat history.

I build an open-source memory layer for AI assistants ([Aura Memory](https://github.com/teolex2020/aura-memory)), so I had a reason to want the first camp to win. Instead of arguing, I spent a week testing it. I used my own real chats with AI coding assistants and public test sets built for exactly this question.

What I found surprised me. Most of the time, the AI does not need to remember anything. When it does, it rarely fails because it *forgot*. It fails because it did not notice that **something changed**.

*How I tested: I wrote down the rules and the pass/fail line of every test before running it, and failed tests are reported as failures. Almost everything ran on one small, cheap model (Google's `gemini-3.1-flash-lite`). The whole week cost about $6.60 in API fees.*

## 1. Most of the time, the AI needs no memory at all

I went through four days of my own work with AI coding assistants: 163 questions and requests in 8 conversations. For each one, a small AI model running on my own computer (nothing left the machine) answered a simple question: *to reply to this, does the assistant need something from an earlier, separate conversation?*

- Only **1 in 10** did. The other nine were about what we were doing right then.
- For those that did, a short "about me" note was enough **7 times out of 10**. It held my recent decisions, facts and plans, about the length of a tweet or two.
- Whether the past mattered could not be guessed from the question itself. The obvious trick is "if an old note looks similar to the question, it's probably needed". That did **no better than a coin toss**. All my conversations are about the same project, so some old note always looks similar.

## 2. When memory is needed, it matters enormously. When it isn't, it barely hurts

I used LongMemEval, a public test made of long, realistic chat histories. Each history comes with questions about things said weeks earlier.

| | AI without memory | AI with memory |
|---|---|---|
| Questions about earlier chats | 9% right | **79%** right |
| General-knowledge questions, with 10 unrelated notes about the user mixed in | 81% right | 80% right |

So memory helps a lot when it is needed. When it is not needed, the AI mostly ignores the extra notes. You pay for the extra text, not with wrong answers.

## 3. "Just give it the whole chat" works, at a price

Then the big question: why bother with memory if the AI can reread everything?

On the same test, I compared two setups:
- **rereading the whole chat history** before every answer, about the length of a novel;
- **looking up the 10 most relevant notes**, about a page.

| What the AI reads before answering | Right answers | How much it reads |
|---|---|---|
| nothing | 10% | — |
| the whole chat history | 78% | ~110,000 tokens (a novel) |
| 10 relevant notes | **82%** | ~730 tokens (a page) |

Rereading everything works about as well as notes, but it reads **about 150 times more text** for every single answer. The gap grows with AI agents, the assistants that work on a task by themselves. I counted 2,000 real agent sessions: one request from a person turned into about **60 rounds** of the AI reading and acting. Give the agent the novel on every round, and you pay for it 60 times.

The whole history won in one place: questions like *"what did you tell me last time?"*. My notes kept only what the person said, not what the AI said. It lost where something had changed. Buried in a novel-length history, the AI more often grabbed the old version.

## 4. The real problem: facts change

Here is a typical failure. In March you tell the assistant you play tennis every week. In July you mention you now play every other week. In September you ask: *"How often do I play tennis?"*

The assistant has both statements. It still often answers "every week".

To measure this properly, I used a test where facts are deliberately overwritten: "X lives in Paris", then later "X lives in Rome". Some questions need to connect several facts, the way a detective connects clues: who is X married to, and where does *that* person live now?

| How the AI works | Right answers on "connect the clues" questions |
|---|---|
| rereads everything | 15% |
| looks up relevant notes | 13% |
| **checks clue by clue**, asking each time *"is there anything newer about this?"* | **44%** |

Neither rereading nor looking things up helps here. What helps is **thinking step by step and checking for newer information**. So the value of memory is not the storage. It is a small analyst that notices what changed.

## 5. But when should you call the analyst?

The step-by-step analyst costs about three times more per answer. You want it only when it helps. Looking back at the results, it was needed for about **1 in 4** of those tricky questions.

I tried three cheap ways to guess when to call it. All three failed:
- **A small AI reads the question and decides.** It called the analyst for almost half of my real questions, and just as often for questions that needed no past at all as for those that did.
- **A small AI reads the question and the notes found.** It called the analyst for 93% of my questions: every note about my project looked like "an old version of something". On the test where facts really had changed, it almost never called it.
- **The assistant decides for itself whether it needs help.** It asked for help far too often, so this cost more than calling the analyst every time. Worse, just being asked made its own answers worse: **82% → 72%** right.

## 6. Then call the analyst every time?

No. On ordinary questions, adding the analyst's notes made answers slightly **worse**: 77% right instead of 79%, and 1.7 seconds slower.

The worst mistakes came from the analyst's own rule, "newer beats older". Asked *"What was my **previous** personal best?"*, it proudly returned the newest one.

## 7. Then let the AI think while it is idle, like sleep

People sort out their memories while they sleep. So I let the AI tidy its notes in its free time: link old and new versions of the same fact. Then a question can be answered in one cheap step.

Linking alone did nothing. Then I looked at all 50 wrong answers. In **every one**, the newer fact was **already sitting among the notes** the AI was given. It picked the old one anyway, or its own general knowledge.

My favourite example: in that test the "official language of the United States" had been deliberately changed to German. The newer note said German. The AI answered "American English". It trusted what it "knew" over what it was told.

The fix was an explicit label. I marked old notes **"outdated: updated later"**, and right answers on single-fact questions jumped from 83% to **95%**, almost as good as the full step-by-step analyst, at a third of the cost.

I came up with that label *after* seeing the failures, so I re-ran it, unchanged, on questions it had never seen:

| | Without labels | With "outdated" labels |
|---|---|---|
| A much larger set of changing facts | 80% | 87% |
| Chat histories: "what is it now?" questions | 85% | **90%** ✅ |
| Chat histories: "how long / when" questions | 82.5% | **77.5%** ❌ |

Only half a win. On chat histories the "sleep" tidied far too much: it found 16,254 "updates" among 19,360 notes. "I started reading the book on January 10" got marked outdated by "I finished it on January 31". After that, the AI could no longer count how many days the book took. Changing your alarm from 8:00 to 7:30 replaces a fact. Finishing a book does not replace starting it. My system could not tell the two apart yet.

## 8. The bug that almost fooled me

Before all of this, I had checked how often the AI actually used its memory. The answer: **once** in about 8,000 actions over several days. I wrote it down as a finding: *AI assistants don't use memory on their own.*

That was wrong. While chasing an unrelated timeout, I found that a Claude Code update had changed how it says hello to the tools it connects to. My connector did not understand the new greeting and froze. For six days the memory tool was simply **missing**, from every conversation. Everything else kept working, so nothing looked broken.

The fix was a few lines of code. The lesson was bigger: **before drawing conclusions about the AI, check the wiring.**

## What I would build from this

1. **The conversation itself**: free, always there.
2. **A short "about me" note at the start of each conversation**: covers most real needs for memory.
3. **A quick look-up of relevant notes once per question**: never at every step of an agent.
4. **The step-by-step analyst only when you actually ask for analysis**, like "what changed?", "compare", "what did we decide and why?".

What I would *not* build yet:
- an analyst that always runs;
- a cheap trick that guesses when to think harder;
- the "sleep" labels. They are the most promising idea here, but they need to learn the difference between a fact that was replaced and an event that simply continued.

## Honest limits

- Almost everything ran on one small model. Bigger models may behave differently.
- The "changing facts" test is artificial. It shows the mechanism, not real life.
- The real-chat numbers come from one person (me) over four days, judged by a small local AI. Only 17 questions needed the past.
- Test sets of 60–120 questions: differences of 2–3 points can be chance.

Everything is public: the rules of each test, the code and the results are in the repo under [`experiments/`](https://github.com/teolex2020/aura-memory/tree/main/experiments) (E57–E63). Test sets used: LongMemEval and MemoryAgentBench (both MIT-licensed), TruthfulQA, and SWE-rebench OpenHands agent sessions.

If you have tried any of this with a bigger model, I would love to know whether it holds up.
