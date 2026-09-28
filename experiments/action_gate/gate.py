"""E12 action-gate prototype (experiment only, not the core). See PROTOCOL.md.

Taint is exact value provenance: an argument value is tainted when it occurs
in untrusted memory but not in first-hand memory and not in the user's
request. No word lists, no language rules.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import unicodedata
from pathlib import Path


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text)).casefold()
    return " ".join(text.split())


def is_first_hand(hit: dict) -> bool:
    meta = hit.get("metadata") or {}
    if hit.get("source_type") != "recorded":
        return False
    if meta.get("relayed_by_model") in ("true", True):
        return False
    return meta.get("claim_certainty") not in ("hearsay", "speculative")


def decide(proposal: dict, request: str, memory: list[dict]) -> dict:
    """Return {"decision": "allow"|"confirm", "tainted": {...}}."""
    trusted = [norm(request)] + [norm(h["content"]) for h in memory if is_first_hand(h)]
    untrusted = [norm(h["content"]) for h in memory if not is_first_hand(h)]
    tainted = {}
    for name, value in (proposal.get("args") or {}).items():
        v = norm(value)
        if not v:
            continue
        in_untrusted = any(v in text for text in untrusted)
        in_trusted = any(v in text for text in trusted)
        if in_untrusted and not in_trusted:
            tainted[name] = value
    return {"decision": "confirm" if tainted else "allow", "tainted": tainted}


def canonical(tool: str, args: dict) -> bytes:
    return json.dumps({"tool": tool, "args": {k: str(v) for k, v in sorted(args.items())}},
                      ensure_ascii=False, sort_keys=True).encode()


class Gate:
    """Issues single-use permits for allowed proposals."""

    def __init__(self, key: bytes):
        self._key = key

    def permit(self, tool: str, args: dict) -> dict:
        nonce = secrets.token_hex(16)
        mac = hmac.new(self._key, canonical(tool, args) + nonce.encode(), hashlib.sha256).hexdigest()
        return {"nonce": nonce, "mac": mac}


class Executor:
    """Runs a tool only with a valid, unused permit for exactly this call.

    Used nonces are appended to a file and fsynced before execution, so a
    permit cannot be replayed after a restart.
    """

    def __init__(self, key: bytes, nonce_file: Path):
        self._key = key
        self._file = nonce_file
        self._used = set(nonce_file.read_text().split()) if nonce_file.exists() else set()
        self.executed: list[tuple[str, dict]] = []

    def execute(self, tool: str, args: dict, permit: dict | None) -> bool:
        if not permit or not isinstance(permit.get("nonce"), str) or not isinstance(permit.get("mac"), str):
            return False
        nonce = permit["nonce"]
        expected = hmac.new(self._key, canonical(tool, args) + nonce.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, permit["mac"]) or nonce in self._used:
            return False
        with open(self._file, "a", encoding="ascii") as handle:
            handle.write(nonce + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self._used.add(nonce)
        self.executed.append((tool, dict(args)))
        return True
