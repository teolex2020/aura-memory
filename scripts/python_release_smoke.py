"""Smoke-test the public API exposed by a built aura-memory wheel."""

from __future__ import annotations

import json
import subprocess
import sys
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

        source_id = brain.store(
            "Release telemetry is healthy",
            namespace="release-check",
            semantic_type="fact",
        )
        claim_id = brain.store(
            "The release candidate is healthy",
            namespace="release-check",
            semantic_type="fact",
        )
        decision_id = brain.store(
            "Publish the verified release candidate",
            level=Level.Decisions,
            namespace="release-check",
            semantic_type="decision",
        )
        brain.annotate_audit_entity(
            source_id, "source", "observed", "release/source"
        )
        brain.annotate_audit_entity(
            claim_id, "claim", "accepted", "release/claim"
        )
        brain.annotate_audit_entity(
            decision_id, "decision", "decided", "release/decision"
        )
        brain.link_audit_entities("release/source", "release/claim", "supports")
        brain.link_audit_entities(
            "release/claim", "release/decision", "recalled_for"
        )
        graph = brain.audit_graph(namespace="release-check")
        assert len(graph["nodes"]) == 3
        assert len(graph["edges"]) == 2
        explanation = brain.explain_decision("release/decision")
        assert explanation["decision"]["entity_id"] == "release/decision"
        assert explanation["evidence"][0]["claim"]["entity_id"] == "release/claim"

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

        mcp_path = root / "mcp-brain"
        requests = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2026-07-28"},
            },
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "store",
                    "arguments": {"content": "MCP integration smoke memory"},
                },
            },
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "recall",
                    "arguments": {"query": "integration smoke"},
                },
            },
        ]
        wire_input = "".join(json.dumps(request) + "\n" for request in requests)
        completed = subprocess.run(
            [sys.executable, "-m", "aura", "mcp", str(mcp_path)],
            input=wire_input,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        responses = [json.loads(line) for line in completed.stdout.splitlines() if line]
        assert len(responses) == 4, completed.stderr
        assert responses[0]["result"]["serverInfo"]["version"] == __version__
        assert responses[0]["result"]["protocolVersion"] == "2025-06-18"
        tools = responses[1]["result"]["tools"]
        assert len(tools) == len(mcp_server.AuraMcpServer.TOOL_MAP)
        store_tool = next(tool for tool in tools if tool["name"] == "store")
        assert store_tool["inputSchema"]["required"] == ["content"]
        assert "Omit level" in store_tool["description"]
        assert responses[2]["result"]["isError"] is False
        assert responses[3]["result"]["isError"] is False
        assert "MCP integration smoke memory" in responses[3]["result"]["content"][0]["text"]

        checked = subprocess.run(
            [sys.executable, "-m", "aura", "mcp", str(mcp_path), "--check"],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        check_result = json.loads(checked.stdout)
        assert check_result["ok"] is True
        assert check_result["tools"] == len(tools)

        configured = subprocess.run(
            [
                sys.executable,
                "-m",
                "aura",
                "mcp",
                str(mcp_path),
                "--print-config",
                "vscode",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        config = json.loads(configured.stdout)
        assert config["servers"]["aura"]["command"] == str(Path(sys.executable).resolve())
        assert config["servers"]["aura"]["type"] == "stdio"
        assert config["servers"]["aura"]["args"][-1] == str(mcp_path.resolve())

    print(f"aura-memory public API smoke passed: {__version__}")


if __name__ == "__main__":
    main()
