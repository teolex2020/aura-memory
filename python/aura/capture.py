"""Conversation capture from Claude Code hooks.

``python -m aura capture <brain>`` is a Claude Code hook command. It turns each
hook event into memory writes whose source comes from the channel the text
arrived on, never from what the text says:

- ``UserPromptSubmit``: the prompt, verbatim, as the user's own words;
- ``PostToolUse``: the tool output, as untrusted data (web, file, MCP, tool);
  Aura's own MCP tools are skipped so recalled memory is not stored again;
- ``Stop``: the assistant's last message, as model-written.

The brain is locked while it is open (the MCP server keeps it open), so the
hook never waits for it: every event is written to a spool directory next to
the brain (``<brain>.inbox``) and ingested, in arrival order, by whoever holds
the brain — the MCP server before each tool call, or the hook itself when the
brain is free. E16-E18 (``experiments/auto_capture``, ``hook_capture``).
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

MAX_CHARS = 8000
USER_CHANNEL = "user-claude-code"
AGENT_CHANNEL = "agent-claude-code"
WEB_TOOLS = {"WebFetch", "WebSearch"}
FILE_TOOLS = {"Read", "Grep", "Glob", "NotebookRead", "LS"}
PROMPT_FIELDS = ("prompt", "user_input", "prompt_text", "user_input_raw")


def inbox_dir(brain_path: str | os.PathLike) -> Path:
    path = Path(brain_path)
    return path.with_name(path.name + ".inbox")


def is_aura_tool(tool_name: str) -> bool:
    """Aura's own MCP tools, under any server name that contains 'aura'."""
    if not tool_name.startswith("mcp__"):
        return False
    server = tool_name.split("__")[1] if tool_name.count("__") >= 2 else ""
    return "aura" in server.lower()


def tool_channel(tool_name: str) -> str:
    if tool_name in WEB_TOOLS:
        return "web"
    if tool_name in FILE_TOOLS:
        return "file"
    if tool_name.startswith("mcp__"):
        parts = tool_name.split("__")
        return f"mcp:{parts[1]}" if len(parts) > 1 and parts[1] else "mcp"
    return "tool"


def response_text(response: Any) -> str:
    """Plain text of a tool response, whatever its shape."""
    if response is None:
        return ""
    if isinstance(response, str):
        return response
    if isinstance(response, list):
        return "\n".join(t for t in (response_text(x) for x in response) if t)
    if isinstance(response, dict):
        if response.get("type") == "text" and isinstance(response.get("text"), str):
            return response["text"]
        file = response.get("file")
        if isinstance(file, dict) and isinstance(file.get("content"), str):
            return file["content"]
        for key in ("content", "result", "results", "output", "text", "snippet"):
            if key in response:
                text = response_text(response[key])
                if text:
                    return text
        out = [response_text(response.get(k)) for k in ("stdout", "stderr")]
        if any(out):
            return "\n".join(t for t in out if t)
        return json.dumps(response, ensure_ascii=False)
    return str(response)


def last_assistant_text(transcript_path: str | None) -> str:
    """Assistant text since the last real user prompt in a Claude Code transcript."""
    if not transcript_path or not Path(transcript_path).exists():
        return ""
    texts: list[str] = []
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = entry.get("message") or {}
            role = message.get("role") or entry.get("type")
            content = message.get("content")
            if role == "user":
                blocks = content if isinstance(content, list) else [content]
                if not all(isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks):
                    texts = []  # a new prompt starts a new turn
            elif role == "assistant":
                blocks = content if isinstance(content, list) else [content]
                for block in blocks:
                    if isinstance(block, str):
                        texts.append(block)
                    elif isinstance(block, dict) and block.get("type") == "text":
                        texts.append(block.get("text", ""))
    return "\n".join(t for t in texts if t.strip())


def items_for(event: dict) -> list[dict]:
    """Memory writes for one hook event: [{text, channel, metadata}]."""
    name = event.get("hook_event_name", "")
    # Event time, so a record keeps when it was said even if the inbox is
    # ingested later (Aura clamps future timestamps to now).
    meta = {"capture": "claude-code", "session": str(event.get("session_id", "")),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if name == "UserPromptSubmit":
        # The field name differs between Claude Code versions and docs.
        text = next((event[k] for k in PROMPT_FIELDS if isinstance(event.get(k), str) and event[k].strip()), "")
        return [{"text": text[:MAX_CHARS], "channel": USER_CHANNEL, "metadata": meta}] if text.strip() else []
    if name == "PostToolUse":
        tool = str(event.get("tool_name", ""))
        if not tool or is_aura_tool(tool):
            return []
        text = response_text(event.get("tool_response"))
        if not text.strip():
            return []
        return [{"text": text[:MAX_CHARS], "channel": tool_channel(tool), "metadata": {**meta, "tool": tool}}]
    if name == "Stop":
        text = event.get("last_assistant_message") or last_assistant_text(event.get("transcript_path"))
        return [{"text": text[:MAX_CHARS], "channel": AGENT_CHANNEL, "metadata": meta}] if text.strip() else []
    return []


def spool(event: dict, brain_path: str | os.PathLike) -> Path | None:
    """Write one event's items to the inbox; returns the file (None if nothing to store)."""
    items = items_for(event)
    if not items:
        return None
    inbox = inbox_dir(brain_path)
    inbox.mkdir(parents=True, exist_ok=True)
    name = f"{time.time_ns():020d}-{uuid.uuid4().hex[:8]}.json"
    tmp = inbox / (name + ".tmp")
    tmp.write_text(json.dumps({"items": items}, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, inbox / name)
    return inbox / name


def pending(brain_path: str | os.PathLike) -> list[Path]:
    inbox = inbox_dir(brain_path)
    return sorted(inbox.glob("*.json")) if inbox.exists() else []


def ingest(brain, brain_path: str | os.PathLike) -> int:
    """Store every spooled event into an open brain, oldest first; returns records stored."""
    from aura import Level

    stored = 0
    for path in pending(brain_path):
        try:
            items = json.loads(path.read_text(encoding="utf-8")).get("items", [])
        except (OSError, json.JSONDecodeError):
            continue
        for item in items:
            brain.store(item["text"], level=Level.Domain, channel=item["channel"],
                        metadata=item.get("metadata"), deduplicate=False)
            stored += 1
        path.unlink(missing_ok=True)
    return stored


def try_ingest(brain_path: str | os.PathLike) -> int | None:
    """Ingest the spool if the brain is free; None if it is held by another process."""
    from aura import Aura

    try:
        brain = Aura(str(brain_path), password=os.environ.get("AURA_PASSWORD") or None)
    except Exception:  # noqa: BLE001 - locked by the MCP server, or not creatable
        return None
    try:
        return ingest(brain, brain_path)
    finally:
        brain.close()


def run_hook(brain_path: str, stream: Iterable[str] | None = None, ingest_now: bool = True) -> int:
    """Hook entry point: never blocks or fails the client; prints nothing."""
    try:
        raw = "".join(stream) if stream is not None else sys.stdin.read()
        event = json.loads(raw) if raw.strip() else {}
        if spool(event, brain_path) is not None and ingest_now:
            try_ingest(brain_path)
    except Exception as exc:  # noqa: BLE001 - a hook must not break the session
        log = inbox_dir(brain_path).with_suffix(".log")
        try:
            log.parent.mkdir(parents=True, exist_ok=True)
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {type(exc).__name__}: {exc}\n")
        except OSError:
            pass
    return 0
