# E1: purge verification and selective repair — preregistered protocol

Date frozen: 2026-09-27, before the first scored run.

Predecessor: `../deletion_residue_audit` (logical delete PASS, derived hygiene
FAIL, full purge FAIL). Its decision rule requires "a second frozen test [that]
covers failure atomicity and every discovered surface" before `purge_record`
is relied on. This is that test.

Motivation: MemSecBench (arXiv 2607.27080) reports selective repair of poisoned
agent memory succeeds in only 56.1% of cases across current memory stacks.
The product question is whether Aura can remove poisoned memories completely
and verifiably without harming benign memories.

No production code is changed by this experiment. Thresholds below are fixed
and must not be tuned after a run. Failures are reported, not retried away.

## Arms

- `delete`: current public `delete(record_id)` (cognitive forgetting).
- `purge_history`: `purge_record(record_id, PurgeScope::History)`.

Each arm runs on its own fresh store built from the same deterministic fixture.

## Fixture (namespace `purge-verification`)

- 40 benign facts. Each contains a unique token `BENIGN_<i>_TOKEN` and shares
  deployment vocabulary with the others.
- 8 poison records. Each contains a unique marker `POISON_<j>_CANARY_7Q` and an
  instruction-like payload that reuses benign vocabulary.
- Every poison is connected to two benign facts; benign facts are also connected
  to each other in a ring.
- Every record gets a deterministic 8-dimensional embedding; poisons are placed
  near the benign facts they are connected to.
- Warm structured recall for every record, create named snapshot
  `before_repair`, run maintenance twice, flush.

## Operation

Remove all 8 poison records through the arm's API, then flush.

## Observation points

1. immediately after the operation;
2. after close and clean reopen;
3. after one maintenance run on the reopened store;
4. after `rollback("before_repair")` on the reopened store.

## Measures

Poison residue:
- logical: `get`, structured recall for each poison marker, lexical search,
  embedding recall near each poison vector, benign records still holding an
  edge to a poison;
- derived: any belief, concept, causal pattern or policy hint referencing a
  poison id;
- bytes: every regular file under the store root containing any poison marker
  (content residue) or any raw poison id (id residue).

Collateral damage on benign facts:
- benign records missing, or with changed content;
- benign self-recall: hit@5 for each `BENIGN_<i>_TOKEN` query, before vs after;
- benign-to-benign ring edges lost.

Receipt (purge arm): serialized receipt contains no marker and no raw id, and
`record_digest == sha256(record_id)`.

Fault probe: call the arm's API on a closed store; record whether it reports
success, and whether RAM and disk disagree after reopen.

## Gates (purge arm)

| Gate | Pass condition |
|---|---|
| G1 logical | 0 poison hits at points 1–3 |
| G2 derived | 0 derived references at points 1–3 |
| G3 content bytes | 0 files with a poison marker at points 1–3 |
| G4 id bytes | 0 files with a raw poison id at points 1–3 |
| G5 rollback | rollback restores 0 poisons |
| G6 collateral | 0 benign missing, 0 changed, 0 ring edges lost, benign hit@5 not lower than before |
| G7 receipt | content-free and digest verifiable for all 8 |
| G8 fault | closed-store call is not reported as success and leaves no RAM/disk split |

The `delete` arm is a control: it is expected to pass G1 and fail G3/G5, which
confirms the fixture detects residue.

## Not covered

Process kill during purge, concurrent writers during purge, residue in OS page
cache, filesystem journals, SSD remapping or backups outside the store root,
embedding stores other than Aura's, and any comparison with other memory
systems (that is E1b).

## Amendments after run 1 (2026-09-27)

Run 1 is preserved unchanged in `results_run1.json`. Gates and thresholds are
not changed. Two measurement defects were found and corrected:

- **A1.** Byte scans ran after the logical probes. The probes query recall with
  each poison marker, and the audit log records those queries, so the scan
  measured residue created by the measurement. Bytes are now scanned first.
- **A2.** The G6 baseline (benign hit@5) was taken before the fixture's
  maintenance runs. Run 1 showed maintenance itself destroyed 38–39 of 40 benign
  facts (a consolidation defect, fixed separately in the core). The
  post-maintenance values are now recorded as well; G6 still uses the
  pre-maintenance baseline, so maintenance damage continues to fail G6.

Core changes made between run 1 and run 2, each with its own regression test:
consolidation only merges when no content is lost; merged-away records are
removed from SDR/lexical/embedding indexes and the binary store; audit purge
also removes retrieve entries whose query is a fragment of, or names a
distinctive token from, the purged content.

## Amendment after run 2 (2026-09-27)

Run 2 is preserved in `results_run2.json`. Immediately after purge it found no
residue; after reopen, `brain.audit` again held 8 marker lines.

- **A3.** Those lines can be recall probes issued by the *previous*
  observation point, i.e. after the purge. Audit lines that contain a marker
  are now classified: a `retrieve` entry timestamped at or after the start of
  the purge is reported as `post_purge_probe_audit_lines` and is not counted
  as purge residue. Every other marker line still fails G3. Gates unchanged.
