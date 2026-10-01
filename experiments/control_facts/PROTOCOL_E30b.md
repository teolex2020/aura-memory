# E30b: control facts with larger local models

Frozen before any E30b run. It follows E30, where:

- the API checker (flash-lite) passed every gate;
- the local `qwen3:4b-instruct` (Ollama) failed: 71.1% of violations caught,
  14.3% false alarms.

The owner prefers local models over an external API.

## Question

Does any larger local model the owner already has pass E30's gates?

## Unchanged from E30

- The same data (`data/items.jsonl`, SHA-256 `99e7ca34…c11e`).
- The same system prompt and message format (`run.py`: `SYSTEM`, `prompt()`).
- The same scoring.
- The same gates:
  - violations caught ≥ 90%;
  - false alarms ≤ 5%;
  - false alarms on hard negatives ≤ 10%;
  - cross-language violations caught ≥ 80%.

## Candidates

All files are in `C:\aura-neural-models`. They run through the same
llama.cpp server build (b9870, CPU) via its OpenAI-compatible chat endpoint,
with temperature 0, JSON response format, and at most 200 output tokens.

| id | file | size |
|---|---|---|
| L1 | Qwen3-4B-Instruct-2507-UD-Q8_K_XL.gguf | 5.1 GB |
| L2 | Qwen3.5-4B-Q4_K_M.gguf | 2.7 GB |
| L3 | gemma-4-E4B-it-Q4_K_M.gguf | 5.0 GB |
| L4 | Phi-4-mini-instruct-Q4_K_M.gguf | 2.5 GB |
| L5 | tencent_Hunyuan-7B-Instruct-Q4_K_M.gguf | 4.6 GB |

- One run per model. llama.cpp at temperature 0 is checked for determinism
  by repeating the first 30 items; any difference is reported.
- A model whose chat template or thinking mode breaks the JSON reply on
  more than 10% of items is reported as not runnable as specified.

## Also reported

Median latency per check on this computer, and resident memory.

## Decision

- **One or more pass:** the smallest passing model is the local option for
  control facts. Its download size is weighed against the owner's rule.
- **None pass:** control facts use the opt-in API checker (E30, C2).

## Amendment D1 (2026-10-01, before any E30b result was scored)

The CPU build took about 30 s per check: 5 models × 360 checks would take
more than 15 hours. All models now run on the Vulkan build with every layer
on the GPU (GTX 1070, 8 GB), still at temperature 0. Latency is reported for
the GPU.

The partial CPU run of L4 (151 of 360) was discarded unread, so that no
model's results mix two backends.
