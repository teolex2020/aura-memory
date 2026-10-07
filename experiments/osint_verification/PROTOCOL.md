# E55: OSINT-style verification — check what would have to be true, not just who said it

Status: **frozen 2026-10-07**, before any model call. **Test only**.

## Question

The owner's idea, OSINT-style: a claim such as "a drone fell on street X at
14:30" is not settled by "I saw it" or "an article says so". It is checked
against what would also have to be true if it happened:
- was there an air-raid alert then;
- are there independent reports from the place;
- do the time and the circumstances agree;
- are all the "sources" one source copied.

Does a model that verifies this way reach better verdicts from memory than
one that searches by the claim and judges? And is the gain from asking its
own verification questions, or from the structured verdict?

## Data

AVeriTeC dev (Schlichtkrull et al., NeurIPS 2023; CC-BY-NC-4.0, research
use only): 500 real claims from 50 fact-checking organisations.

| Verdict | Claims |
|---|---|
| Refuted | 305 |
| Supported | 122 |
| Conflicting Evidence/Cherrypicking | 38 |
| Not Enough Evidence | 35 |

**Memory.** Every annotated answer of every dev claim becomes one record:
`Q: <annotator question> A: <answer> (source: <domain of source_url>)`.
All 500 claims share one pool, so for each claim most records are
unrelated. Labels and justifications are never shown.

**Embeddings.** bge-m3 on local Ollama, normalised, cosine.

## Arms

Each claim is shown with its date and speaker when present.

| Arm | Evidence shown | Verdict prompt |
|---|---|---|
| N | none (the model's own knowledge) | plain |
| D | top 10 records by similarity to the claim | plain |
| DS | the same 10 records as D | OSINT structured |
| O | up to 10 records found by the model's own verification questions | OSINT structured |

**O, the steps:**
1. **Ask.** Without any evidence, the model writes 3–5 verification
   questions: what would have to be true, or what an investigator would
   check, if the claim were true.
2. **Search.** Each question takes its top 3 records. They are merged by
   best rank, up to 10 unique records, the same budget as D.

**Verdict prompts:**
- **Plain:** pick one of the four labels, with their AVeriTeC definitions.
- **OSINT structured:**
  1. for each verification question, answer from the records, citing
     record numbers or "not found" (in DS the model first writes its own
     questions within the same reply);
  2. count independent sources, meaning distinct source domains, and note
     whether reports are copies of one another;
  3. then pick the label.

Both prompts return JSON with `"verdict"`.

**Labels and definitions:**

| Label | Definition |
|---|---|
| Supported | the evidence supports the claim |
| Refuted | the evidence contradicts the claim |
| Not Enough Evidence | the evidence does not decide it |
| Conflicting Evidence/Cherrypicking | the evidence points both ways, or the claim is technically true but misleading |

**Models:** `gemini-3.1-flash-lite` and `gemini-2.5-flash` (thinking off),
temperature 0.

## Metrics

- Verdict accuracy and macro-F1 over the 4 labels.
- **False support:** the share of claims whose gold label is not Supported
  but the prediction is Supported.
- **Evidence recall:** the share of the claim's own annotated records among
  the 10 shown, for D/DS and for O.

## Gates (pooled over both models)

| Gate | Pass |
|---|---|
| O1 | the OSINT approach decides better: macro-F1(O) − macro-F1(D) ≥ +5 pp |
| O2 | its own questions find more of the claim's evidence: recall(O) ≥ recall(D) + 10 pp |
| O3 | fewer false "Supported": false support(O) ≤ 0.75 × false support(D) |

DS separates the two effects:
- O vs DS is the effect of the model's own search;
- DS vs D is the effect of the structured verdict.

## Also reported

- Per-class F1.
- Per model.
- N, as a baseline.
- Cost: own cache, hard stop at **$5**.

## Limitation known in advance

The records keep the annotators' questions, which were written by fact-checkers
who already knew the case. Real memory holds raw reports, not answers to
verification questions. That favours search by claim too (D), so it
understates rather than overstates O's possible gain. Still, the evidence
here is cleaner than real-world OSINT material.
