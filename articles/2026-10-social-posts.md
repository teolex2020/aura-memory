# Social posts (October 2026)

## X / Twitter

A model that doesn't have your stated preference goes against it in 90% of answers (PrefEval). When memory hands it over: 0.6%.

So I built Aura: one local memory shared by Claude Code, Cursor, Codex, Copilot and other AI tools. Free for Windows.

https://www.aurasdk.dev/desktop

---

## LinkedIn

Every AI tool you use starts from zero. You tell Claude Code you deploy only from the release branch, and an hour later Cursor writes a script that pushes to main.

I measured how much this costs on PrefEval (ICLR 2025). When a model doesn't have your stated preference, it goes against it in 90% of answers. When memory hands the preference over, in 0.6%. Models follow what you said well. They just don't have it.

So I built Aura, a free Windows app that gives all your AI tools one local memory:

• One click connects Claude Code, Cursor, Codex, Gemini CLI, Copilot in VS Code, Windsurf, Claude Desktop and LM Studio.
• It keeps your words as you said them, not AI summaries: 79% of questions answered vs 25% with summaries (LongMemEval).
• Every memory is labelled with its source, so text from a page or document is never stored as something you said.
• A journal shows exactly what each AI received. Everything stays on your computer.

It's an early preview, Windows only. Feedback from people who use several AI tools a day is very welcome.

https://www.aurasdk.dev/desktop

#AI #DeveloperTools #LLM

---

# Memory research posts

## X / Twitter

I spent 3 months teaching AI memory what matters. Most clever ideas lost.

LLM summaries answered 25% of questions about past chats; the user's own words, 79%. "Keep what's retrieved most" was the worst rule.

Aura Memory, open source:
https://github.com/teolex2020/aura-memory

---

## LinkedIn

For three months I tried to teach AI memory to decide for itself what is worth keeping. I ran ten experiments, each with its pass/fail thresholds fixed before the run. Most of my clever ideas lost.

What held up:

• Keep the user's words; don't summarize them. On LongMemEval the user's own messages answered 79% of questions at 12% of the text. LLM session summaries answered 25%.
• "Keep what gets retrieved most" was the worst forgetting rule I tested, worse than simply forgetting the oldest.
• Value can be learned from consequences: a tiny network trained on "removing this memory broke a correct answer" beat time-based forgetting by 13.5 points.
• An agent's own signals don't show success. On 67,000 coding-agent runs, exit codes and the agent's passing tests predicted real success barely better than chance. Real outcome signals come from people.

My takeaway: memory doesn't need a smarter brain at write time. It needs to keep what you said, deliver it at the right moment with its source, and learn what matters from real consequences.

Aura Memory is open source (MIT, Rust with Python bindings). Version 1.60.1 is out with a fix for a data-loss bug in consolidation.

https://github.com/teolex2020/aura-memory

#AI #MachineLearning #LLM #AIAgents
