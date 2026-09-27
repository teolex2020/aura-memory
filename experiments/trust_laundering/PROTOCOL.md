# E2: trust laundering through derived layers — preregistered protocol

Date frozen: 2026-09-27, before the first scored run.

Question: can content that entered Aura from an untrusted channel come back
out labelled or treated as trusted? This is the property that distinguishes
a memory-integrity layer from write-time screening (OWASP Agent Memory Guard)
and that TMA-NM (arXiv 2606.24322) reports baselines fail up to 68% of the time.

A code reading (2026-09-27) found candidate paths L1–L8. This run measures the
current core; it changes no production code. A follow-up run after fixes uses
the same scenarios and gates.

## Trust order

`recorded` (3) > `retrieved` (2) > `inferred` (1) > `generated` (0).
"Untrusted" below means `retrieved` or lower, set explicitly by the writer.

## Scenarios

Each runs on a fresh store, namespace `laundering`.

- **S1 default label.** `store()` with no `source_type` (what the MCP tool does
  when the model omits it). Measure the stored `source_type`.
- **S2 merge upgrade.** A `recorded` fact R and a `retrieved` record R' whose
  text is R plus an injected clause; run `consolidate()`. Measure the surviving
  record's text and `source_type`.
- **S3 supersede.** Supersede a `retrieved` record. Measure the successor's
  `source_type`.
- **S4 policy from untrusted evidence.** Two cause records (tag `deploy`) and
  two effect records (tag `outage`, `caused_by_id` → cause) plus 6 unrelated
  filler records; two maintenance runs. Arms by source_type of cause+effect
  records: `recorded` (control), `retrieved`, `generated`. Measure surfaced
  policy hints whose supporting/cause records are all from the arm's records,
  and whether the hint exposes that its evidence is untrusted.

## Gates (a laundering-free core passes all)

| Gate | Pass condition |
|---|---|
| T1 | S1 stores something other than `recorded` when the writer did not assert it |
| T2 | S2 never yields a record whose text contains untrusted content but whose `source_type` outranks that content's origin |
| T3 | S3 successor never outranks its predecessor |
| T4 | S4 untrusted arms surface no hint unless the hint carries an explicit untrusted-evidence marker |
| T0 (validity) | S4 `recorded` control surfaces ≥ 1 hint; otherwise T4 is inconclusive |

## Not covered

Experience capture (L4), sybil belief resolution, concept laundering, recall
rerank magnitude, cross-namespace effects, LLM-generated attack text.

## Runs and amendment (2026-09-27/28)

- Run 1 (`results_run1.json`, unchanged core): T0 PASS, T1 FAIL, T2 not
  triggered (MinHash < 0.85, no merge happened), T3 FAIL, T4 FAIL.
- Core changes after run 1: policy hints record `evidence_source_floor`; hints
  resting on evidence below `recorded` are capped at `verify_first` and
  surfaced with `untrusted_evidence = true`; `supersede` keeps the
  predecessor's `source_type`; merges never raise the kept record's label.
- Run 2 (`results_run2.json`) still scored T4 by counting every surfaced hint,
  because the scorer predates the marker.
- **C1.** The T4 scorer now implements the frozen wording — an untrusted-arm
  hint fails unless it carries the marker — and additionally requires the
  cap to VerifyFirst (serialized by the API as `"verify"`). Gate wording
  unchanged.
- T1 (default label) is a product decision, not a defect fix; see RESULTS.
