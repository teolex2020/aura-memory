"""Smoke-test the public API exposed by a built aura-memory wheel."""

from __future__ import annotations

import tempfile
from pathlib import Path

from aura import Aura, Level, __version__
import aura.mcp_server as mcp_server


def main() -> None:
    assert mcp_server.__version__ == __version__

    with tempfile.TemporaryDirectory(prefix="aura-release-smoke-") as temporary:
        root = Path(temporary)
        brain_path = root / "brain"
        container_path = root / "memory.aura"
        signed_container_path = root / "memory-signed.aura"
        checkpoint_path = root / "trusted" / "memory.checkpoint.json"
        brain = Aura(str(brain_path))
        brain.store(
            "The safe release requires verified evidence",
            level=Level.Domain,
            tags=["goal", "release"],
            namespace="release-check",
        )
        experience_id = brain.store(
            "Refresh an expired release token before retrying",
            level=Level.Decisions,
            tags=["experience", "release"],
            namespace="release-check",
            semantic_type="decision",
            metadata={
                "applicability.require.cause": "expired_token",
                "applicability.require.environment": "ready",
            },
        )
        applicable = brain.evaluate_applicability(
            experience_id,
            {"cause": ["expired_token"], "environment": ["ready"]},
        )
        assert applicable["decision"] == "use"
        annotated = brain.recall_with_applicability(
            "release token retry",
            {"cause": ["permission_denied"], "environment": ["ready"]},
            top_k=5,
            namespace="release-check",
        )
        experience_result = next(
            item for item in annotated if item["id"] == experience_id
        )
        assert experience_result["applicability"]["decision"] == "reject"

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

        exported = brain.export_container(str(container_path))
        assert exported["generation"] == 1
        assert Aura.verify_container(str(container_path))["generation"] == 1

        keys = Aura.generate_container_signing_key()
        signed = brain.export_signed_container(
            str(signed_container_path),
            keys["private_key"],
        )
        assert signed["generation"] == 1
        authenticity = Aura.verify_container_authenticity(
            str(signed_container_path),
            trusted_public_key=keys["public_key"],
            require_all_signed=True,
        )
        assert authenticity["verified"] is True
        assert authenticity["all_generations_signed"] is True
        checkpoint = Aura.update_container_authenticity_checkpoint(
            str(signed_container_path),
            str(checkpoint_path),
            keys["public_key"],
        )
        assert checkpoint["generation"] == 1
        checkpoint_status = Aura.verify_container_authenticity_checkpoint(
            str(signed_container_path),
            str(checkpoint_path),
        )
        assert checkpoint_status["checkpoint_is_current"] is True
        brain.close()

        restored_path = root / "restored"
        Aura.import_container(str(container_path), str(restored_path))
        restored = Aura(str(restored_path))
        assert restored.recall("safe release", namespace="release-check")
        restored.close()

        trusted_restore_path = root / "trusted-restored"
        Aura.import_authenticated_container(
            str(signed_container_path),
            str(trusted_restore_path),
            keys["public_key"],
            require_all_signed=True,
        )
        trusted_restored = Aura(str(trusted_restore_path))
        assert trusted_restored.recall("safe release", namespace="release-check")
        trusted_restored.close()

    print(f"aura-memory public API smoke passed: {__version__}")


if __name__ == "__main__":
    main()
