"""Smoke-test the public API exposed by a built aura-memory wheel."""

from __future__ import annotations

import tempfile

from aura import Aura, Level, __version__
import aura.mcp_server as mcp_server


def main() -> None:
    assert mcp_server.__version__ == __version__

    with tempfile.TemporaryDirectory(prefix="aura-release-smoke-") as brain_path:
        brain = Aura(brain_path)
        brain.store(
            "The safe release requires verified evidence",
            level=Level.Domain,
            tags=["goal", "release"],
            namespace="release-check",
        )

        capsule = brain.build_context_capsule(
            purpose="prepare the safe release",
            token_budget=256,
            namespace="release-check",
        )
        assert capsule["entries"]

        brain.reset_recall_hit_stats()
        assert brain.recall("safe release", namespace="release-check")
        stats = brain.recall_hit_stats()
        assert stats["recall_total"] == 1
        assert stats["recall_empty"] == 0

        project = brain.start_research("release evidence")
        source = b"Value: 42"
        finding = brain.add_research_evidence_finding(
            project["id"],
            "value",
            "Value is 42",
            "release-doc",
            "rev-1",
            "file:///release-doc.txt",
            list(source),
            0,
            len(source),
            verification_status="verified",
            answer_permission="cite",
        )
        assert finding["integrity_valid"] is True
        assert finding["admission"] == "cite"
        brain.close()

    print(f"aura-memory public API smoke passed: {__version__}")


if __name__ == "__main__":
    main()
