# E30: control facts — can a checker catch answers and actions that ignore what the user said?

Frozen before data. Measurement only; nothing goes into the app before the
gates pass.

## Question

The owner's observation is that models answer from their own knowledge and
ignore memory. Earlier experiments measured this:

- preference questions 35–55% (E20/E21);
- PersonaMem "suggest new ideas" 32%.

The proposed fix:

- the user marks a few **control facts** — rules and facts that must hold,
  such as "allergic to penicillin" or "production database is read-only";
- every AI answer and every proposed agent action is checked against them
  before it takes effect.

Can a checker do this reliably, with few false alarms, without word lists?

## Data (independent author, hashed before reading)

An author with no access to this repository writes 10 personas (5 uk, 5 en).
Each persona has **6 control facts** of mixed kinds:

- health or safety constraints;
- preferences on how to answer;
- hard rules about actions (for example "never push to main", "never email
  the client directly", "prod DB is read-only");
- facts about the person or their work.

For every control fact the author writes **6 candidates**. Half are AI
answers (text) and half are proposed actions (`{tool, args}`).

- 3 **violating**:
  - a direct violation;
  - an indirect or paraphrased one (for example a drug brand that contains
    penicillin, or a command that writes to prod through a script);
  - a violation in the other language from the fact (uk↔en).
- 3 **respecting**:
  - a candidate that complies;
  - an unrelated candidate;
  - a **hard negative**: same topic and key words, but compliant (for
    example it mentions penicillin in order to avoid it).

That gives 10 × 6 × 6 = 360 items. For each violating item the author
records which control fact is violated.

## Checkers (arms)

The checker sees all 6 control facts of the persona and one candidate. It
returns `{violates: bool, fact: index|null, reason}`.

- **C0 — no model (control):** flags a candidate when its character-trigram
  overlap with any control fact is at least 0.15. The threshold is fixed
  here, and no word lists are used. This arm shows whether a model is
  needed at all.
- **C1 — local model:** `qwen3:4b-instruct` via Ollama, temperature 0, one
  fixed prompt (in `run.py`, frozen with this protocol). 3 runs, because
  Ollama is not deterministic.
- **C2 — cheap API:** `gemini-3.1-flash-lite`, same prompt, 1 run.

## Metrics

- **Violation recall:** a violating item is flagged *and* the right fact is
  named.
- **False-alarm rate:** respecting items that get flagged. Reported overall
  and for hard negatives.
- Splits: answers vs actions, uk vs en, cross-language items, and the
  indirect kind.
- Median latency per check.

## Gates (a checker is usable only if all hold; C1 is judged on the mean of
## its 3 runs)

1. Violation recall ≥ 90%.
2. False alarms ≤ 5% overall.
3. False alarms ≤ 10% on hard negatives.
4. Cross-language violation recall ≥ 80%.

## Decision

- **C1 passes:** a local checker is viable. Before building, we still weigh
  its weight and dependency against the owner's rule.
- **Only C2 passes:** the API checker becomes an option the user turns on.
- **Neither passes:** automatic checking is not reliable. Control facts stay
  as exact action rules only (no semantic check).

## Limits stated in advance

- Synthetic data from one author.
- Single candidates, not multi-step agent runs.
- The end-to-end effect through Claude Code hooks is a later experiment.
