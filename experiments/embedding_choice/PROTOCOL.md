# E34: which small embedding model for the optional smart search?

Frozen before any model is downloaded or run. Measurement only.

## Question

E31 showed that embeddings matter a great deal: evidence in the top 10 is
95.8% with them and 80.8% without. The app will offer them as an opt-in
download. Which model should that be, for an international product?

The criteria are:

- quality across many languages;
- query and memory written in different languages;
- small download and memory use;
- speed on an ordinary CPU;
- a license that allows commercial use.

## Candidates (from desk research, 2026-10-01)

| id | model | runtime |
|---|---|---|
| BGE | BAAI/bge-m3 (baseline) | Ollama `bge-m3` |
| QWEN | Qwen3-Embedding-0.6B | Ollama `qwen3-embedding:0.6b` |
| GEMMA | Google EmbeddingGemma-300M | Ollama `embeddinggemma` |
| GRANITE | IBM granite-embedding-311m-multilingual-r2 | llama.cpp (GGUF) |
| HARRIER | Microsoft Harrier-OSS-v1-0.6b | llama.cpp (GGUF) |

Each model gets its documented query and document formats: instruction
prefixes for QWEN and HARRIER, task prompts for GEMMA, plain text for BGE
and GRANITE. These formats are recorded in `run.py` before any run. A model
that cannot be run as documented is reported as not runnable.

## Datasets

- **D1 — LongMemEval-S, 120 questions** (E19 selection, E31 harness, through
  Aura). Metric: evidence in top 10.
- **D2 — E32 personas** (uk/en, through Aura, global recall). Metric: hit@5
  on all 240 questions. Paraphrased identity questions are reported
  separately.
- **D3 — Belebele, 15 languages.** `mteb/belebele`, using the questions and
  passages:
  - eng, spa, deu, fra, por, ita, pol, ukr, rus, zho_Hans, jpn, kor, arb, hin,
    tur;
  - plain embedding retrieval (cosine) of the right passage among all
    passages of the target language;
  - **mono**: question and passages in the same language, all 15;
  - **cross**: English question with passages in each other language, and
    each other language's question with English passages.

  Metric: recall@1 and nDCG@10, macro-averaged over languages.

## Also measured on this computer

- Download size.
- Resident memory while embedding.
- Documents embedded per second on CPU: the same 2,000 D1 turns for every
  model.
- Median query latency.

## Decision rule (fixed now)

1. Exclude any model whose license forbids commercial use. GEMMA's custom
   terms are flagged for the owner, not excluded.
2. A model **qualifies** if each of these is within 3 pp of the best model:
   D1, D2, D3-mono and D3-cross.
3. The **winner** is the qualifying model with the smallest download. Ties go
   to higher D3-cross.
4. If none qualifies, the winner is the model with the highest D3-cross
   (international use first), and the trade-off is reported.

## Limits stated in advance

- One computer for the speed numbers.
- Belebele passages are formal text, not personal memory.
- D1 is English only.

## Amendment D1 (2026-10-01, before any D1 or D3 score of any model)

The first run used the CPU llama.cpp build with an oversized batch (8192).
It used up to 11 GB of memory and embedded about 1.5 texts per second, so
the planned run would take days. Changes:

- **Quality runs** (D1, D2, D3) use the Vulkan build on the GPU (GTX 1070),
  with `-c 4096 -b 4096 -ub 4096 -ngl 99`. The device does not change the
  metrics. Embeddings cached by the CPU run are reused.
- **D1** uses the first 10 questions of each type in E19's selection: 60
  questions instead of 120.
- **D3** uses the first 300 questions of each language: 300 × 15 queries
  over all 488 passages per language, instead of 900.
- **Speed and memory** are measured on the CPU build with
  `-c 2048 -b 2048 -ub 2048 -t 6`, on 200 English Belebele passages. This
  is what a user without a GPU gets. The GPU rate is reported too.

Decision rule unchanged.

At the time of this amendment, only BGE had a D2 score (96.2, the same as
E32's EMB arm). No D1 or D3 score existed for any model.

## Amendment D2 (2026-10-01, after D1 failed mid-run for four models)

QWEN, GEMMA, GRANITE and HARRIER stopped during D1 with HTTP 400/500
errors: some LongMemEval turns are longer than the model's context
(EmbeddingGemma takes 2k tokens). The analysis that ran after the failure
used partial D1 rows (GEMMA 11/60) and is void.

Change: when a request fails, each text is embedded on its own, and a text
the model rejects is shortened (to 70%, repeatedly) until it fits, as an app
would. Texts that fit are unchanged, so BGE's complete D1 run and the D1 rows
already written stay valid. The number of shortened texts per model is
reported. D2 and D3 had no failures and are unchanged.
