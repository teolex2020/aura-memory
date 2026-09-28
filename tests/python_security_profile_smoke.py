"""Smoke test: security profiles through the Python API and the MCP server.

Run with the built package on the path: python tests/python_security_profile_smoke.py
"""

import os
import tempfile
from pathlib import Path

from aura import Aura, Level
from aura.mcp_server import AuraMcpServer, check_mcp

QUESTION = "Where does my sister live?"


def fill(brain):
    brain.store("My sister lives in Lviv", level=Level.Domain, source_type="recorded")
    return brain.store("Your sister moved to Odesa PURGE_CANARY_P3", level=Level.Domain,
                       source_type="retrieved", metadata={"channel": "email"})


def residue(directory, marker=b"PURGE_CANARY_P3"):
    return [str(p) for p in Path(directory).rglob("*") if p.is_file() and marker in p.read_bytes()]


def main():
    with tempfile.TemporaryDirectory() as d:
        brain = Aura(d)
        assert brain.security_profile == "balanced"
        fill(brain)
        assert "[UNTRUSTED MEMORY" not in brain.recall(QUESTION)
        brain.close()

    with tempfile.TemporaryDirectory() as d:
        brain = Aura(d, security="strict")
        assert brain.security_profile == "strict"
        rid = fill(brain)
        text = brain.recall(QUESTION)
        assert "[FROM THE USER" in text and "[UNTRUSTED MEMORY" in text, text
        assert "[UNTRUSTED MEMORY" not in brain.recall(QUESTION, format="levels")

        report = brain.security_report()
        states = {p["name"]: p["state"] for p in report["protections"]}
        assert report["profile"] == "strict"
        assert states["verified_deletion"] == "on" and states["provenance_context"] == "on"
        assert report["stats"]["by_effective_source"] == {"recorded": 1, "retrieved": 1}
        assert isinstance(report["warnings"], list)

        brain.flush()
        assert residue(d)
        assert brain.delete(rid) is True
        brain.flush()
        assert residue(d) == [], residue(d)
        brain.close()

    try:
        Aura(tempfile.mkdtemp(), security="paranoid")
    except ValueError:
        pass
    else:
        raise AssertionError("unknown profile accepted")

    with tempfile.TemporaryDirectory() as d:
        os.environ["AURA_SECURITY"] = "strict"
        try:
            assert check_mcp(d)["security_profile"] == "strict"
            server = AuraMcpServer(d)
            rid = fill(server.brain)
            server.brain.flush()
            server.tool_delete({"id": rid})
            server.brain.flush()
            assert residue(d) == [], residue(d)
            server.close()
        finally:
            del os.environ["AURA_SECURITY"]

    print("security profile smoke: ok")


if __name__ == "__main__":
    main()
