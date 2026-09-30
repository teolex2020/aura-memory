"""Local check of the Aura provider on a few LongMemEval questions (no LLM calls).

Usage (benchmark venv, Aura build on PYTHONPATH, from the benchmark checkout):
    python smoke.py <n_questions>
Prints per question: turns stored, ingest seconds, whether a gold session is
among the sessions behind Aura's context, and the context size.
"""

import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from memory_bench.dataset import get_dataset  # noqa: E402

from aura_provider import AuraMemoryProvider  # noqa: E402


def main(n: int) -> None:
    ds = get_dataset("longmemeval")
    queries = ds.load_queries("s")[:n] if hasattr(ds, "load_queries") else None
    if queries is None:
        raise SystemExit(f"dataset API: {dir(ds)}")
    provider = AuraMemoryProvider()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        provider.prepare(Path(tmp), reset=True)
        for q in queries:
            docs = ds.load_documents("s", ids=None, user_ids={q.user_id}) if "user_ids" in ds.load_documents.__code__.co_varnames else [
                d for d in ds.load_documents("s") if d.user_id == q.user_id]
            t0 = time.perf_counter()
            provider.ingest(docs)
            ingest_s = time.perf_counter() - t0
            t0 = time.perf_counter()
            out, raw = provider.retrieve(q.query, user_id=q.user_id)
            retrieve_ms = (time.perf_counter() - t0) * 1000
            gold = set(q.gold_ids)
            hit = bool(gold & set(raw["sources"]))
            print(f"{q.id}: sessions {len(docs)}, ingest {ingest_s:.1f}s, retrieve {retrieve_ms:.0f} ms, "
                  f"gold session behind context: {hit}, context {len(out[0].content)} chars", flush=True)
        provider.cleanup()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
