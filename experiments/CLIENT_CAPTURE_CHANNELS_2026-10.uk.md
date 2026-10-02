# Як Aura може бачити розмову в різних ШІ-інструментах (2026-10-02)

Питання власника: чому автоматичний запис розмов прив'язаний до Claude, коли
користувач може працювати з будь-яким інструментом?

**Відповідь:** MCP дає моделі викликати Aura, але Aura **не бачить** самої
розмови: ні слів користувача, ні відповіді, ні результатів інструментів. У
поточній специфікації MCP (2026-07-28) такого механізму немає й не
планується. Тому кожен інструмент потребує свого бокового каналу.

Дослідження агента за офіційною документацією, журналами змін і репозиторіями.
Позначене «?» агент не зміг перевірити.

## Хто що дає зараз

| Інструмент | Механізм | Слова користувача | Результати інструментів | Відповідь моделі | Статус |
|---|---|---|---|---|---|
| **Claude Code** | хуки, JSON на stdin; також OpenTelemetry | ✅ | ✅ | ✅ | стабільно (у нас зроблено) |
| **Cursor** | `hooks.json` | ✅ | ✅ | ✅ | з 1.7; читає і хуки Claude Code (перемикач) |
| **Gemini CLI** | хуки; OpenTelemetry | ✅ | ✅ | ✅ | увімкнено з v0.26 |
| **Windsurf / Devin Desktop** | `hooks.json` | ✅ | ✅ | ✅ + повний журнал | з ~листопада 2025 |
| **Codex CLI** | хуки у форматі Claude; OpenTelemetry | ✅ | ✅ | через файл стенограми | з 0.114 (березень 2026) |
| **Copilot у VS Code** | хуки агента у форматі Claude | ✅ | ✅ | через файл стенограми | Preview з 1.109; у Copilot CLI — GA |
| Cline | скрипти-хуки | ✅ | ✅ | ? | на Windows неблокувальні хуки CLI зламані |
| JetBrains Junie | хуки (лише CLI) | ✅ | ❌ | ? | EAP |
| Continue | файли dev-data; хуки CLI | ✅ | частково | ? | dev-data стабільні |
| Zed, JetBrains AI Assistant | лише MCP (і ACP для зовнішніх агентів) | ❌ | ❌ | ❌ | — |
| Jan / LM Studio / Ollama | файли розмов на диску | файли | файли | файли | у Jan задокументовано; LM Studio і Ollama — без гарантій |
| Claude Desktop, ChatGPT Desktop | лише MCP + офіційний експорт | ❌ | ❌ | ❌ | хуки Claude Code там не спрацьовують |
| ChatGPT / Claude.ai / Gemini у браузері | лише розширення браузера | ⚠️ | ⚠️ | ⚠️ | ризик з умовами користування (OpenAI, Anthropic забороняють автоматичне вилучення) |

## Висновки

1. **Живий запис розмов можливий майже лише в інструментах для розробників.**
   - Повний цикл (слова, інструменти, відповідь) дають Claude Code, Cursor,
     Gemini CLI і Windsurf.
   - Codex і Copilot у VS Code дають те саме, але відповідь доводиться брати
     з файлу стенограми.
2. **Формат хуків Claude Code став фактичним стандартом.**
   - Cursor і VS Code вміють читати `~/.claude/settings.json` (за
     перемикачем).
   - Codex, Copilot CLI, Junie і Continue CLI використовують ті самі назви
     подій і JSON.
   - **Один перехідник у форматі Claude з нормалізацією назв полів покриває
     ~7 інструментів.** Для Windsurf і Cline потрібні невеликі доповнення.
3. **Альтернатива без скриптів — локальний приймач OpenTelemetry (OTLP).**
   Claude Code, Codex і Gemini CLI вміють слати події
   `user_prompt` / `tool_result` / `assistant_response` за змінними
   середовища.
4. **Для Zed і JetBrains — посередник ACP** (Agent Client Protocol). Через
   нього видно всю розмову зовнішніх агентів. Потрібен експеримент.
5. **Звичайні користувачі** (ChatGPT, Gemini, Claude.ai) — **лише MCP і
   імпорт офіційних експортів.** Розширення браузера технічно можливе, але
   суперечить умовам OpenAI та Anthropic.
6. **Локальні чати** (Jan, LM Studio, Ollama) — читати їхні файли розмов.
   Аудиторія мала, але вона якраз цінує приватність.

## Що це означає для продукту

- **Для розробників** Aura може бути «живою» пам'яттю, яка бачить розмову,
  результати і наслідки. Для цього потрібен один універсальний перехідник
  замість прив'язки до Claude.
- **Для звичайних користувачів** чат-ботів Aura лишається пам'яттю, яку модель
  викликає сама, плюс імпорт. Автоматичного запису і сигналів наслідків там
  не буде.
- Це звужує природну аудиторію «живої частини» до розробників з
  агентними інструментами. Це треба врахувати в позиціонуванні.

## Джерела

- code.claude.com/docs/en/hooks
- cursor.com/docs/agent/hooks
- learn.chatgpt.com/docs/hooks
- geminicli.com/docs/hooks/reference
- code.visualstudio.com/docs/agent-customization/hooks
- docs.github.com/en/copilot/reference/hooks-reference
- docs.devin.ai/desktop/cascade/hooks
- cline.bot/blog/cline-v3-36-hooks
- docs.continue.dev/customize/deep-dives/development-data
- junie.jetbrains.com/docs/junie-cli-hooks.html
- jetbrains.com/acp
- jan.ai/docs/desktop/data-folder
- lmstudio.ai/docs/app/basics/chat
- anthropic.com/legal/consumer-terms
- github.com/anthropics/claude-code/issues/63360
- docs.roocode.com/sunset (Roo Code закрито 2026-05-15)
