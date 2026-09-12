"""Regression smoke for the installed wheel's storage and recall contracts."""
from pathlib import Path
from shutil import copy2
from tempfile import TemporaryDirectory

from aura import Aura, Level


def main():
    with TemporaryDirectory(prefix="aura-audit-") as temporary:
        root = Path(temporary) / "brain"
        brain = Aura(str(root), password="regression-password")
        try:
            first = brain.store("Friday deployment is allowed after verification", level=Level.Domain)
            second = brain.store("Friday deployment is not allowed after verification", level=Level.Domain)
            assert first != second
            brain.connect(first, second, weight=0.8, relationship="causal")
            brain.store_embedding(first, [1.0, 0.0, 0.0])
            try:
                brain.store_embedding(second, [1.0, 0.0])
            except ValueError:
                pass
            else:
                raise AssertionError("inconsistent vector dimensions were accepted")
            # Optional indexing errors must not turn an already committed
            # record into a failed store or leave its recall cache stale.
            brain.set_embedding_fn(lambda _: [1.0, 0.0])
            committed = brain.store("A record with an invalid optional embedding", deduplicate=False)
            assert brain.get(committed) is not None
            brain.clear_embedding_fn()
            brain.store("Launch secret is UPPER_CASE_MARKER", namespace="TeamA", level=Level.Domain)
            brain.store("Launch secret is LOWER_CASE_MARKER", namespace="teama", level=Level.Domain)
            assert "UPPER_CASE_MARKER" in brain.recall("Launch secret", namespace="TeamA")
            result = brain.recall("Launch secret", namespace="teama")
            assert "LOWER_CASE_MARKER" in result and "UPPER_CASE_MARKER" not in result
        finally:
            brain.close()
        del brain
        for password in (None, "wrong-password"):
            try:
                unlocked = Aura(str(root), password=password)
            except (OSError, ValueError, RuntimeError):
                pass
            else:
                unlocked.close()
                raise AssertionError("encrypted store opened without valid credentials")
        brain = Aura(str(root), password="regression-password")
        try:
            assert brain.get(first).content == "Friday deployment is allowed after verification"
            assert brain.has_embeddings()
            brain.set_embedding_fn(lambda _: [1.0, 0.0, 0.0])
            assert "Friday deployment" in brain.recall("unrelated vocabulary", min_strength=0.0)
            container = Path(temporary) / "backup.aura"
            brain.export_container(str(container))
            restored_root = Path(temporary) / "restored"
            Aura.import_container(str(container), str(restored_root))
            # Portable containers deliberately exclude key material.
            assert not (restored_root / "memory.key").exists()
            copy2(root / "memory.key", restored_root / "memory.key")
            restored = Aura(str(restored_root), password="regression-password")
            try:
                assert restored.get(first).content == brain.get(first).content
                assert restored.has_embeddings()
            finally:
                restored.close()
            del restored
            assert brain.delete(first)
        finally:
            brain.close()
        del brain
        brain = Aura(str(root), password="regression-password")
        try:
            assert brain.get(first) is None
            assert not brain.has_embeddings()
        finally:
            brain.close()
        del brain
        for path in Path(temporary).rglob("*"):
            if path.is_file():
                assert b"UPPER_CASE_MARKER" not in path.read_bytes(), path
    print("Python audit smoke passed")


if __name__ == "__main__":
    main()
