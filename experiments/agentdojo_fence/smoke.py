"""E49 pre-check (not a result): does AgentDojo's GoogleLLM run with our models, and what does a task cost?

One user task per suite, no injection. Run with E:\\aura-benchmarks\\agentdojo-venv\\Scripts\\python.exe.
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types as genai_types

from agentdojo.agent_pipeline import AgentPipeline, InitQuery, SystemMessage, ToolsExecutionLoop, ToolsExecutor
from agentdojo.agent_pipeline.agent_pipeline import load_system_message
from agentdojo.agent_pipeline.llms.google_llm import GoogleLLM
from agentdojo.benchmark import run_task_without_injection_tasks
from agentdojo.logging import OutputLogger
from agentdojo.task_suite.load_suites import get_suites

REPO = Path(__file__).resolve().parents[2]
KEY = next(m.group(1) for line in (REPO / ".env").read_text(encoding="utf-8").splitlines()
           if (m := re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)))
VERSION = "v1.2.1"
USAGE: list[tuple[int, int]] = []


class CountingModels:
    """Records token usage of every generate_content call."""

    def __init__(self, models):
        self._models = models

    def generate_content(self, *args, **kwargs):
        config = kwargs.get("config")
        if config is not None and "2.5" in str(kwargs.get("model", "")):
            config.thinking_config = genai_types.ThinkingConfig(thinking_budget=0)  # as in E48
        response = self._models.generate_content(*args, **kwargs)
        u = response.usage_metadata
        USAGE.append((u.prompt_token_count or 0, (u.candidates_token_count or 0) + (u.thoughts_token_count or 0)))
        return response

    def __getattr__(self, name):
        return getattr(self._models, name)


def pipeline(model: str) -> AgentPipeline:
    real = genai.Client(api_key=KEY)
    client = type("CountingClient", (), {"models": CountingModels(real.models), "real": real})()
    llm = GoogleLLM(model, client, temperature=0.0, max_tokens=2048)  # type: ignore[arg-type]
    p = AgentPipeline([SystemMessage(load_system_message(None)), InitQuery(), llm,
                       ToolsExecutionLoop([ToolsExecutor(), llm])])
    p.name = model
    return p


if __name__ == "__main__":
    model = sys.argv[1]
    suites = get_suites(VERSION)
    for name, suite in suites.items():
        task = next(iter(suite.user_tasks.values()))
        USAGE.clear()
        t = time.time()
        try:
            with OutputLogger(None):
                ok, _ = run_task_without_injection_tasks(suite, pipeline(model), task, None, True, VERSION)
            status = f"utility={ok}"
        except Exception as err:  # noqa: BLE001
            status = f"ERROR {type(err).__name__}: {str(err)[:300]}"
        pin = sum(u[0] for u in USAGE)
        pout = sum(u[1] for u in USAGE)
        print(f"{name}: {task.ID} {status}; calls {len(USAGE)}, prompt {pin}, out {pout}, {time.time() - t:.0f}s")
