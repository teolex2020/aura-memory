# Social posts: Aura app + memory research (October 2026)

Links to fill in before posting:
- `[APP]` = https://www.aurasdk.dev/desktop
- `[ARTICLE-APP]` = the DEV.to link to "Your AI Ignores What You Told It 90% of the Time…"
- `[ARTICLE-RESEARCH]` = the DEV.to link to "I Tried to Teach AI Memory What Matters…"

Every number below comes from our experiments (E25, E31, E35–E46).

---

## X / Twitter

### Thread 1: the app (6 posts)

**1/**
Your AI ignores what you told it.

I measured it on PrefEval (ICLR 2025): when a model doesn't have your stated preference, it goes against it in 90% of answers.

When memory hands the preference over: 0.6%.

The failure isn't reasoning. It's delivery. 🧵

**2/**
And every tool starts from zero.

Tell Claude Code you deploy only from `release`. Open Cursor an hour later, ask for a deploy script, and it pushes to `main`.

So I built one memory that all your AI tools share.

**3/**
Aura is a free Windows tray app.

One click connects Claude Code, Cursor, Codex, Gemini CLI, Copilot in VS Code, Windsurf, Claude Desktop and LM Studio.

Tell one tool something once. The others know it.

Everything stays on your computer.

**4/**
It keeps your words as you said them, not AI summaries.

On LongMemEval:
• your own words: 79% of questions answered, at 12% of the text
• LLM session summaries: 25%

Summaries drop the dates, numbers and names you need later.

**5/**
Every memory is labelled: you said it, an AI relayed it, an AI concluded it, or it came from outside (a page, a doc, a tool).

Planted "facts" got through 22% of the time with Aura's labels vs 74% with mem0, on the same attacks.

**6/**
There is also a journal of what each AI received, private memories, per-app access, and a "what left" report.

It's a preview: Windows only and not code-signed yet.

Try it: [APP]
Full write-up: [ARTICLE-APP]

---

### Thread 2: the research (7 posts)

**1/**
I spent three months trying to teach AI memory what matters.

10 experiments, every protocol fixed before the run.

Most of my clever ideas lost. Here is what survived. 🧵

**2/**
Lesson 1: keep the user's words. Don't summarize them.

LongMemEval, 120 questions:
• user's own messages: 79%
• whole conversation: 85%
• LLM summaries: 25%

Half the summaries also invented what the assistant "recommended".

**3/**
Lesson 2: "promote what gets retrieved often" is the worst forgetting rule I tested.

With 25% capacity:
• no forgetting: 65%
• forget the oldest: 44%
• keep what's retrieved most: 34.5%

Often retrieved ≠ useful. Just similar to many questions.

**4/**
Lesson 3: value IS learnable from consequences.

A 66k-weight net trained on "removing this record broke a correct answer" beat time-based forgetting by +13.5 pts across 6 splits.

It transferred to user–assistant chats: 45% vs 32%.

**5/**
Lesson 4: value isn't length, and it isn't "surprise".

• "keep long messages" kept 98% assistant chatter and 5% of what was needed
• model surprisal predicted almost nothing (AUC 0.55 / 0.41)

What helped was meaning: decisions, plans, preferences, facts.

**6/**
Lesson 5: an agent's own signals don't tell you if it succeeded.

On 67k OpenHands runs, exit codes and its own passing tests predicted real success at AUC 0.51–0.53.

Real outcome signals come from people: corrections, repeats, what survives to a commit.

**7/**
What I'd say now:

memory doesn't need a smarter write-time brain. It needs to keep what you said, deliver it labelled at the right moment, and learn what matters from consequences.

Full post: [ARTICLE-RESEARCH]

---

### Standalone posts (for later days)

**A.**
LLM session summaries answered 25% of questions about past chats.

Just keeping the user's own messages: 79%, at an eighth of the size.

Stop summarizing your users. [ARTICLE-RESEARCH]

**B.**
67,000 coding-agent runs.

"Tests passed and the agent finished" meant the task was really solved 52% of the time, against a 48% base rate.

Agents write tests that their own patch passes. [ARTICLE-RESEARCH]

**C.**
A model without your stated preference goes against it in 90% of answers. With it: 0.6%.

Memory isn't about smarter models. It's about delivery.

One memory for all your AI tools: [APP]

**D. (release note)**
Aura Memory 1.60.1 is out: a data-loss fix.

Consolidation merged facts that differed only by a number or a "not" (40 distinct facts → 1 in one test). Merges now need identical words, in any language.

`pip install -U aura-memory`

---

## LinkedIn

### Post 1: the app

Every AI tool you use starts from zero.

You tell Claude Code that you deploy only from the release branch. An hour later Cursor writes a script that pushes to main. Tomorrow you explain it all again.

I wanted to know how much this actually costs, so I measured it on PrefEval (ICLR 2025):

→ When a model doesn't have your stated preference, it goes against it in 90% of answers.
→ When memory hands the preference over: 0.6%.

Models are good at following what you said. They just don't have it.

So I built Aura, a free Windows app that gives all your AI tools one local memory:

• One click connects Claude Code, Cursor, Codex, Gemini CLI, Copilot in VS Code, Windsurf, Claude Desktop and LM Studio.
• It keeps your words as you said them, not AI summaries. On LongMemEval your own words answered 79% of questions; LLM summaries answered 25%.
• Every memory is labelled with its source, so text from a web page or document can never pass as something you said. Planted "facts" got through 22% of the time vs 74% for mem0.
• It has a journal of exactly what each AI received, private memories, and per-app access.
• Everything stays on your computer.

It's an early preview: Windows only and not code-signed yet. I'd value feedback from anyone who uses several AI tools a day.

Download: [APP]
How it works and what we measured: [ARTICLE-APP]

#AI #DeveloperTools #LLM #Privacy #OpenSource

---

### Post 2: the research

For three months I tried to teach AI memory to decide for itself what is worth keeping. I ran ten experiments, each with its protocol and pass/fail thresholds committed before the run.

Most of my clever ideas lost. What survived:

1️⃣ Keep the user's words; don't summarize them. On LongMemEval the user's own messages answered 79% of questions at 12% of the text. LLM session summaries answered 25%, and half of them invented things.

2️⃣ "Keep what gets retrieved most" was the worst forgetting rule I tested: 34.5%, against 44% for simply forgetting the oldest. Frequently retrieved is not the same as useful.

3️⃣ Value can be learned from consequences. A tiny network (66k weights) trained on "removing this memory broke a correct answer" beat time-based forgetting by 13.5 points across six splits, and transferred from one dataset to another.

4️⃣ Value is not length and not "surprise". Keeping long messages kept assistant chatter, and model surprisal predicted almost nothing. What helped was meaning: decisions, plans, preferences, facts.

5️⃣ An agent's own signals don't show success. On 67,000 coding-agent runs, exit codes and the agent's own passing tests predicted real success barely better than chance. Real outcome signals come from people.

My takeaway: memory doesn't need a smarter brain at write time. It needs to keep what you said, deliver it at the right moment with its source, and learn what matters from real consequences.

We also shipped Aura Memory 1.60.1, a fix for a data-loss bug in consolidation.

Full write-up: [ARTICLE-RESEARCH]

#AI #MachineLearning #LLM #AIAgents #Research

---

## Українською (для перегляду)

**Тред 1 (програма):**
1. Ваш ШІ ігнорує сказане вами: без вашого вподобання модель іде проти нього у 90% відповідей (PrefEval). Коли пам'ять його передає, у 0,6%. Збій не в мисленні моделі, а в доставці.
2. Кожен інструмент починає з нуля: сказали Claude Code «тільки з release», а Cursor за годину пушить у main. Тож я зробив одну пам'ять для всіх ШІ-інструментів.
3. Aura — безкоштовна програма в треї для Windows. Один клік підключає 8 інструментів. Сказали одному, знають усі. Усе на вашому комп'ютері.
4. Зберігає ваші слова, а не підсумки ШІ: 79% проти 25% на LongMemEval.
5. Кожен запис позначено джерелом; підкинуті «факти» проходять у 22% випадків проти 74% у mem0.
6. Журнал, приватні записи, доступ для кожної програми окремо. Попередня версія, лише Windows, без підпису. Посилання.

**Тред 2 (дослідження):**
1. Три місяці я вчив пам'ять ШІ розуміти, що важливо. 10 експериментів, протоколи зафіксовано до запуску. Більшість хитрих ідей програли.
2. Зберігайте слова користувача, а не підсумки: 79% проти 25%.
3. «Підвищувати те, що часто дістають» — найгірше правило: 34,5%.
4. Цінність можна вивчити з наслідків: мікромережа +13,5 пункту на 6 розбиттях, і переноситься на інші розмови.
5. Цінність — не довжина і не «несподіваність». Важить зміст: рішення, плани, вподобання, факти.
6. Власні сигнали агента (коди виходу, тести) майже не кажуть, чи задачу вирішено. Сигнали наслідків мають іти від людей.
7. Висновок: пам'яті потрібен не розумніший мозок під час запису, а зберігати сказане, доставляти його з джерелом і вчитися з наслідків.

**LinkedIn** — ті самі тези довшими абзацами: пост 1 про програму, пост 2 про дослідження і випуск 1.60.1.
