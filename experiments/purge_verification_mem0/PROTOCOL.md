# E1b: selective repair in mem0 — preregistered protocol

Date frozen: 2026-09-27, before the first scored run.

Companion to `../purge_verification` (E1). Same question, same fixture, a
different memory system: can poisoned memories be removed completely and
verifiably, without harming benign memories?

System under test: `mem0ai` 2.2.1 (PyPI), open-source `Memory` class, local
Qdrant (`path`, `on_disk=True`) and the default SQLite history database.
`MEM0_TELEMETRY=False`; no network is used.

## Isolation choices (fixed before the run)

- `add(..., infer=False)`: memories are stored verbatim, no LLM extraction.
  This is mem0's documented raw-write path and matches E1, which also stores
  verbatim text.
- Embedder: a deterministic hashed bag-of-words embedder (64 dims) registered
  through mem0's own factory. It gives lexical retrieval so that searching a
  unique token can find the record that contains it. It is not a semantic
  model; retrieval quality is not a claim of this experiment.
- LLM: a registered stub that raises if called. With `infer=False` it must
  never be called; a call aborts the run.

## Fixture

Identical text to E1: 40 benign facts with `BENIGN_<i>_TOKEN`, 8 poisons with
`POISON_<j>_CANARY_7Q`, all under `user_id="purge-verification"`. mem0 has no
record links, snapshots or derived layers, so those parts of E1 do not apply.

## Operation

`Memory.delete(memory_id)` for each of the 8 poisons — the only selective
removal API in mem0's open-source `Memory`. (`delete_all` and `reset` are
scope-wide, not selective; they are not tested as repair.)

## Observation points

1. immediately after the deletes;
2. after closing both stores and constructing a new `Memory` on the same paths.

Bytes are scanned before logical probes at each point (E1 amendment A1 applied
from the start).

## Measures and gates

| Gate | Pass condition | Notes |
|---|---|---|
| G1 logical | 0 poisons returned by `get`, `get_all`, or `search(marker)` at points 1–2 | |
| G2 derived | n/a | no derived layer at `infer=False` |
| G3 content bytes | 0 files under the store root containing a poison marker at points 1–2 | includes SQLite, WAL, Qdrant files |
| G4 id bytes | 0 files containing a raw poison memory id at points 1–2 | |
| G5 rollback | n/a | no snapshot API |
| G6 collateral | 0 benign missing, 0 changed, benign self-search hit@5 not lower than before | |
| G7 receipt | a returned artifact proves removal without containing content | mem0 returns a message string |
| G8 fault | n/a | no close/reopen fault surface comparable to E1 |

`Memory.history(poison_id)` after deletion is reported separately: it is the
public API through which deleted content remains readable.

## Not covered

mem0 Platform (hosted), graph memory, `infer=True` pipelines, other vector
stores, concurrent writers, crash during delete.

## Amendment after run 1 (2026-09-27)

Run 1 is preserved in `results_run1.json`.

- **B1.** Qdrant holds an OS lock on `qdrant/.lock` while open, so the file
  cannot be read. Run 1 counted it as a marker file. Unreadable files are now
  listed under `unreadable_files` and not counted. Gate outcomes did not depend
  on it: `history.db` and `storage.sqlite` failed G3/G4 on their own.
