"""Aura memory provider for the Agent Memory Benchmark (vectorize-io/agent-memory-benchmark).

Registered at run time by `run_amb.py`; the benchmark's own code is not changed.

* Each conversation turn is stored verbatim with its role as the write
  channel: user turns `channel="user"` (first-hand), assistant turns
  `channel="agent"` (the assistant's own words, untrusted) — the capture rule
  from E16–E18. The session time is kept as `metadata.timestamp`.
* One Aura store per isolation unit (`user_id`), on disk under the
  benchmark's store directory, so `--skip-ingestion` reuses it.
* Embeddings: `bge-m3` through the local Ollama server, the model used in
  E19/E20 (stored texts are embedded in batches before they are written).
* `retrieve()` returns Aura's default context — `recall(query)` — as one
  document, with the source session ids of the recalled records.
"""

from __future__ import annotations

import json
import os
import shutil
import urllib.request
from pathlib import Path

from memory_bench.memory.base import MemoryProvider
from memory_bench.models import Document

from aura import Aura, Level

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = "bge-m3"
MAX_CHARS = 2000  # Ollama rejects very long inputs to bge-m3 (E19)


def _rfc3339(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if value.endswith("Z") or "+" in value[10:] or value[10:].count("-") > 0:
        return value
    return value + "Z"


def _turns(doc: Document) -> list[dict]:
    if doc.messages:
        return [t for t in doc.messages if isinstance(t, dict)]
    try:
        parsed = json.loads(doc.content)
        if isinstance(parsed, list) and all(isinstance(t, dict) for t in parsed):
            return parsed
    except (TypeError, ValueError):
        pass
    return [{"role": "user", "content": doc.content}]


def _ollama_embed(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": MODEL, "input": [t[:MAX_CHARS] for t in texts]}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as response:
        return json.loads(response.read())["embeddings"]


class AuraMemoryProvider(MemoryProvider):
    name = "aura"
    description = ("Aura (Rust, local): turns stored verbatim by role; provenance context "
                   "(first-hand vs untrusted), identity block, first-hand dates. Dense: bge-m3.")
    kind = "local"
    provider = "aura"
    link = "https://github.com/teolex2020/aura-memory"
    concurrency = 1

    def __init__(self):
        self._root: Path | None = None
        self._brains: dict[str, Aura] = {}
        self._vectors: dict[str, list[float]] = {}

    # ── embeddings ──
    def _embed(self, text: str) -> list[float]:
        vector = self._vectors.get(text)
        if vector is None:
            vector = _ollama_embed([text])[0]
        return vector

    def _precompute(self, texts: list[str], batch: int = 64) -> None:
        missing = [t for t in dict.fromkeys(texts) if t and t not in self._vectors]
        for i in range(0, len(missing), batch):
            chunk = missing[i:i + batch]
            self._vectors.update(zip(chunk, _ollama_embed(chunk)))

    # ── stores ──
    def prepare(self, store_dir: Path, unit_ids: set[str] | None = None, reset: bool = True) -> None:
        self.cleanup()
        # E28: AURA_STORE_DIR points at stores built by an earlier run (with
        # --skip-ingestion), so context variants are compared on the same memory.
        override = os.environ.get("AURA_STORE_DIR")
        self._root = Path(override) if override else Path(store_dir) / "aura"
        if reset and not override and self._root.exists():
            shutil.rmtree(self._root)
        self._root.mkdir(parents=True, exist_ok=True)

    MAX_OPEN = 2  # keep only the most recent stores open (memory)

    def _brain(self, unit: str | None) -> Aura:
        key = unit or "default"
        if key not in self._brains:
            if self._root is None:
                raise RuntimeError("prepare() was not called")
            while len(self._brains) >= self.MAX_OPEN:
                oldest = next(iter(self._brains))
                try:
                    self._brains.pop(oldest).close()
                except Exception:  # noqa: BLE001
                    pass
            safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
            brain = Aura(str(self._root / safe))
            brain.set_embedding_fn(self._embed)
            self._brains[key] = brain
        return self._brains[key]

    def cleanup(self) -> None:
        for brain in self._brains.values():
            try:
                brain.close()
            except Exception:  # noqa: BLE001
                pass
        self._brains = {}

    # ── benchmark interface ──
    def ingest(self, documents: list[Document]) -> None:
        self._precompute([str(t.get("content") or "").strip() for doc in documents for t in _turns(doc)])
        for doc in documents:
            brain = self._brain(doc.user_id)
            stamp = _rfc3339(doc.timestamp)
            for turn in _turns(doc):
                text = str(turn.get("content") or "").strip()
                if not text:
                    continue
                role = str(turn.get("role") or "user")
                meta = {"doc_id": doc.id}
                if stamp:
                    meta["timestamp"] = stamp
                brain.store(text, level=Level.Domain, channel="user" if role == "user" else "agent",
                            metadata=meta, deduplicate=False)
        for brain in self._brains.values():
            brain.flush()
        self._vectors.clear()

    def retrieve(self, query: str, k: int = 10, user_id: str | None = None,
                 query_timestamp: str | None = None) -> tuple[list[Document], dict | None]:
        brain = self._brain(user_id)
        # E28: AURA_RECALL_FORMAT selects a context variant of the test build.
        context = brain.recall(query, format=os.environ.get("AURA_RECALL_FORMAT") or None)
        sources: list[str] = []
        for hit in brain.recall_structured(query, top_k=20):
            record = brain.get(hit["id"])
            doc_id = (record.metadata or {}).get("doc_id") if record is not None else None
            if doc_id and doc_id not in sources:
                sources.append(doc_id)
        doc = Document(id=f"aura:{user_id or 'default'}", content=context, source_ids=sources)
        # No raw response: the harness's LongMemEval prompt substitutes a raw
        # response for the formatted context when one is returned.
        return [doc], None
