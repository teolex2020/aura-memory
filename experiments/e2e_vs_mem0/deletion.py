"""E13 suite S4: is a deleted memory recoverable? See PROTOCOL.md.

Usage (mem0 venv with the Aura build on PYTHONPATH): python deletion.py
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from run import DIMS, HERE, Memory, embed  # registers the mem0 providers

from aura import Aura, Level

MARKER = "FORGET-CANARY-58"
SECRET = f"My previous home address was Lindenweg {MARKER}, please keep it private"
PROBE = "What was my previous home address?"
BENIGN = [f"User fact number {i}: my favourite tea is blend {i}" for i in range(10)]


def files_with(root: Path) -> list[str]:
    """Files containing the marker; a file locked by the open store is listed
    as "locked:<path>" instead (as in E1b amendment B1)."""
    needle = MARKER.encode()
    out = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        try:
            if needle in path.read_bytes():
                out.append(rel)
        except OSError:
            out.append(f"locked:{rel}")
    return out


def residue(files: list[str]) -> list[str]:
    return [f for f in files if not f.startswith("locked:")]


def aura_run(profile: str) -> dict:
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)

        def open_brain():
            brain = Aura(str(root), security=profile)
            brain.set_embedding_fn(embed)
            return brain

        def api_paths(brain, rid):
            paths = []
            if brain.get(rid) is not None:
                paths.append("get")
            if any(MARKER in h["content"] for h in brain.recall_structured(PROBE, top_k=20)):
                paths.append("recall_structured")
            if MARKER in brain.recall(PROBE):
                paths.append("recall")
            return paths

        brain = open_brain()
        for text in BENIGN:
            brain.store(text, level=Level.Domain, source_type="recorded", deduplicate=False)
        rid = brain.store(SECRET, level=Level.Domain, source_type="recorded", deduplicate=False)
        brain.snapshot("before")
        brain.flush()
        before = files_with(root)
        deleted = brain.delete(rid)
        brain.flush()
        after = {"files": files_with(root), "api": api_paths(brain, rid)}
        brain.close()
        brain = open_brain()
        reopened = {"files": files_with(root), "api": api_paths(brain, rid)}
        brain.rollback("before")
        rolled = {"api": api_paths(brain, rid)}
        benign_left = sum(1 for text in BENIGN
                          if any(h["content"] == text for h in brain.recall_structured(text, top_k=5)))
        brain.close()
        closed = files_with(root)
    return {"system": f"aura-{profile}", "files_before": len(before), "deleted": deleted,
            "after_delete": after, "after_reopen": reopened, "after_close_post_rollback": closed,
            "rollback_restores": bool(rolled["api"]), "rollback_api": rolled["api"],
            "benign_findable_after": benign_left}


def mem0_run() -> dict:
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)

        def open_memory():
            return Memory.from_config({
                "vector_store": {"provider": "qdrant", "config": {
                    "collection_name": "e13del", "path": str(root / "qdrant"), "on_disk": True,
                    "embedding_model_dims": DIMS}},
                "embedder": {"provider": "huggingface", "config": {"embedding_dims": DIMS}},
                "llm": {"provider": "openai", "config": {}},
                "history_db_path": str(root / "history.db"),
            })

        def close(memory):
            for closer in (lambda: memory.vector_store.client.close(), lambda: memory.db.close()):
                try:
                    closer()
                except Exception:  # noqa: BLE001
                    pass

        def api_paths(memory, mid):
            paths = []
            try:
                got = memory.get(mid)
                if got and MARKER in json.dumps(got, ensure_ascii=False):
                    paths.append("get")
            except Exception:  # noqa: BLE001
                pass
            hits = memory.search(PROBE, filters={"user_id": "e13"}, top_k=20)["results"]
            if any(MARKER in h["memory"] for h in hits):
                paths.append("search")
            listed = memory.get_all(filters={"user_id": "e13"}, top_k=1000)["results"]
            if any(MARKER in h["memory"] for h in listed):
                paths.append("get_all")
            if MARKER in json.dumps(memory.history(mid), ensure_ascii=False, default=str):
                paths.append("history")
            return paths

        memory = open_memory()
        for text in BENIGN:
            memory.add([{"role": "user", "content": text}], user_id="e13", infer=False)
        mid = memory.add([{"role": "user", "content": SECRET}], user_id="e13", infer=False)["results"][0]["id"]
        before = files_with(root)
        memory.delete(mid)
        after = {"files": files_with(root), "api": api_paths(memory, mid)}
        close(memory)
        memory = open_memory()
        reopened = {"files": files_with(root), "api": api_paths(memory, mid)}
        close(memory)
        del memory
        import gc
        gc.collect()
        closed = files_with(root)
    return {"system": "mem0", "files_before": len(before), "deleted": True,
            "after_delete": after, "after_reopen": reopened, "after_close": closed,
            "rollback_restores": None, "rollback_api": None, "benign_findable_after": None}


def main() -> None:
    results = [mem0_run(), aura_run("balanced"), aura_run("strict")]
    strict = results[2]
    gate = (not residue(strict["after_delete"]["files"]) and not residue(strict["after_reopen"]["files"])
            and not strict["after_delete"]["api"] and not strict["after_reopen"]["api"]
            and not strict["rollback_restores"])
    out = {"results": results, "G5": gate}
    (HERE / "results_deletion.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
