"""Portable MCP client configuration for Aura.

The generated command uses the exact Python interpreter running this module.
This avoids a common desktop-client failure where ``python`` or ``aura-mcp``
is not available on the GUI application's PATH.
"""

from __future__ import annotations

import sys
from pathlib import Path


SUPPORTED_CLIENTS = ("claude", "cursor", "vscode", "generic")


def build_mcp_config(
    client: str,
    brain_path: str,
    *,
    python_executable: str | None = None,
) -> dict:
    """Return a ready-to-paste MCP configuration for a supported client."""
    normalized = client.lower()
    if normalized not in SUPPORTED_CLIENTS:
        supported = ", ".join(SUPPORTED_CLIENTS)
        raise ValueError(f"unsupported MCP client '{client}'; expected one of: {supported}")

    executable = str(Path(python_executable or sys.executable).resolve())
    resolved_brain = str(Path(brain_path).expanduser().resolve())
    server = {
        "command": executable,
        "args": ["-m", "aura", "mcp", resolved_brain],
    }

    if normalized == "vscode":
        server["type"] = "stdio"
        return {"servers": {"aura": server}}

    return {"mcpServers": {"aura": server}}
