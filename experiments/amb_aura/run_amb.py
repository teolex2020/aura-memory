"""Run the Agent Memory Benchmark with the Aura provider registered.

Usage (the benchmark's venv, the Aura build on PYTHONPATH, from the benchmark
checkout directory):
    python <this file> run --dataset longmemeval --split s ...

The Gemini key is read from the AuraSDK repository's .env (GOOGLE_API_KEY)
and passed to the benchmark as GEMINI_API_KEY; it is never printed. The
answer model defaults to gemini-3.1-pro-preview, the model of the published
results this run is compared with.
"""

import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


os.environ.setdefault("GEMINI_API_KEY", _key())
os.environ.setdefault("OMB_ANSWER_LLM", "gemini")
os.environ.setdefault("OMB_ANSWER_MODEL", "gemini-3.1-pro-preview")

from memory_bench.memory import REGISTRY  # noqa: E402

from aura_provider import AuraMemoryProvider  # noqa: E402

REGISTRY["aura"] = AuraMemoryProvider

from memory_bench.cli import app  # noqa: E402

if __name__ == "__main__":
    app()
