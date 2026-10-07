"""E57 Part L: latency of recall, query embedding, hook start and model calls. See PROTOCOL.md.

Run with target/ci-venv (aura built). Uses E19's embedding cache through E35/E56 helpers.
    python latency.py recall | embed | hook | model
Results append to results_latency.json.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = HERE / "results_latency.json"

_spec = importlib.util.spec_from_file_location("e56", HERE.parent / "journal_lookup" / "run.py")
e56 = importlib.util.module_from_spec(_spec)
sys.modules["e56"] = e56
_spec.loader.exec_module(e56)
e35, e19 = e56.e35, e56.e19
from aura import Aura, Level  # noqa: E402

SIZES = (300, 3000, 30000)
N_QUERIES = 50


def save(key: str, value) -> None:
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    data[key] = value
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(json.dumps({key: value}, indent=1))


def stats(ms: list[float]) -> dict:
    ms = sorted(ms)
    return {"median_ms": round(statistics.median(ms), 2), "p95_ms": round(ms[int(0.95 * (len(ms) - 1))], 2), "n": len(ms)}


def corpus(n: int) -> list[str]:
    out, seen = [], set()
    for q in e19.load():
        for s in q["haystack_sessions"]:
            for t in s:
                c = t["content"].strip()
                if c and c not in seen:
                    seen.add(c)
                    out.append(c)
                    if len(out) >= n:
                        return out
    return out


def recall(sizes_modes=None) -> None:
    """sizes_modes: [(n, mode)] to run; default all. 30k with embeddings was dropped (too slow to build on CPU)."""
    texts = corpus(max(SIZES))
    questions = [q["question"] for q in e35.questions()][:N_QUERIES]
    res = json.loads(OUT.read_text(encoding="utf-8")).get("recall", {}) if OUT.exists() else {}
    plan = sizes_modes or [(n, m) for n in SIZES for m in ("embeddings", "lexical")]
    for n, mode in plan:
        if True:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                brain = Aura(str(Path(d) / "aura"))
                if mode == "embeddings":
                    brain.set_embedding_fn(e19.embed)
                t0 = time.perf_counter()
                for t in texts[:n]:
                    brain.store(t, level=Level.Domain, channel="user-claude-code", deduplicate=False)
                if hasattr(brain, "flush_consolidation"):
                    brain.flush_consolidation()
                build_s = time.perf_counter() - t0
                brain.recall_structured(questions[0], top_k=10)  # warm-up
                ms = []
                for q in questions:
                    t1 = time.perf_counter()
                    brain.recall_structured(q, top_k=10)
                    ms.append(1000 * (time.perf_counter() - t1))
                brain.close()
            res[f"{n}_{mode}"] = {**stats(ms), "build_s": round(build_s, 1)}
            print(json.dumps({f"{n}_{mode}": res[f"{n}_{mode}"]}), flush=True)
    save("recall", res)


def embed() -> None:
    texts = [f"fresh query number {i}: what did I decide about the release plan last week?" for i in range(30)]
    ms = []
    for t in texts:
        body = json.dumps({"model": "bge-m3", "input": [t], "truncate": True}).encode()
        req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body, headers={"Content-Type": "application/json"})
        t0 = time.perf_counter()
        urllib.request.urlopen(req, timeout=120).read()
        ms.append(1000 * (time.perf_counter() - t0))
    save("query_embedding_bge_m3", stats(ms[1:]))


def hook() -> None:
    """Process start plus the MCP initialize round trip through the running app (nothing is written)."""
    exe = os.path.join(os.environ["LOCALAPPDATA"], "Aura", "aura-bridge.exe")
    init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}}) + "\n"
    ms = []
    for _ in range(20):
        t0 = time.perf_counter()
        p = subprocess.Popen([exe, "--client", "probe"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p.stdin.write(init.encode()); p.stdin.flush()
        p.stdout.readline()
        ms.append(1000 * (time.perf_counter() - t0))
        p.kill(); p.wait()
    save("bridge_start_and_handshake", stats(ms))


def model() -> None:
    key = next(m.group(1) for line in (REPO / ".env").read_text(encoding="utf-8").splitlines()
               if (m := re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)))
    pad_source = " ".join(corpus(400))
    words = pad_source.split()
    res = {}
    for model_name in ("gemini-3.1-flash-lite", "gemini-2.5-flash"):
        for tokens in (0, 1000, 4000, 16000):
            pad = " ".join(words[: int(tokens * 0.75)])  # ~0.75 words per token
            user = (f"Context:\n{pad}\n\n" if pad else "") + "Question: In one short sentence, what is a memory?"
            ms, prompt_tokens = [], []
            for _ in range(5):
                config = {"temperature": 0, "maxOutputTokens": 30}
                if model_name == "gemini-2.5-flash":
                    config["thinkingConfig"] = {"thinkingBudget": 0}
                body = json.dumps({"contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": config}).encode()
                req = urllib.request.Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                    data=body, headers={"x-goog-api-key": key, "Content-Type": "application/json"})
                t0 = time.perf_counter()
                d = json.loads(urllib.request.urlopen(req, timeout=300).read())
                ms.append(1000 * (time.perf_counter() - t0))
                prompt_tokens.append(d.get("usageMetadata", {}).get("promptTokenCount", 0))
            res[f"{model_name}_{tokens}"] = {**stats(ms), "prompt_tokens": int(statistics.median(prompt_tokens))}
            print(json.dumps({f"{model_name}_{tokens}": res[f"{model_name}_{tokens}"]}), flush=True)
    save("model_latency", res)


if __name__ == "__main__":
    {"recall": recall, "embed": embed, "hook": hook, "model": model,
     "recall30k": lambda: recall([(30000, "lexical")])}[sys.argv[1]]()
