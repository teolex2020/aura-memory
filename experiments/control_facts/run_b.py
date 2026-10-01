"""E30b: E30's control-fact check on larger local models via llama.cpp.

See PROTOCOL_E30b.md. Same data, prompt and scoring as run.py.
    python run_b.py check L1..L5   -> results/L<n>.jsonl (+ determinism check)
    python run_b.py analyze        -> results/summary_b.json
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import run as e30

HERE = Path(__file__).resolve().parent
# Amendment D1: GPU (Vulkan) build; the CPU build took ~30 s per check.
LLAMA = Path(r"D:\Aura-clean\tools\neural_runner\llama-b9870-vulkan\llama-server.exe")
MODELS_DIR = Path(r"C:\aura-neural-models")
PORT = 8735
MODELS = {
    "L1": "Qwen3-4B-Instruct-2507-UD-Q8_K_XL.gguf",
    "L2": "Qwen3.5-4B-Q4_K_M.gguf",
    "L3": "gemma-4-E4B-it-Q4_K_M.gguf",
    "L4": "Phi-4-mini-instruct-Q4_K_M.gguf",
    "L5": "tencent_Hunyuan-7B-Instruct-Q4_K_M.gguf",
}


def start(model: str) -> subprocess.Popen:
    proc = subprocess.Popen(
        [str(LLAMA), "-m", str(MODELS_DIR / MODELS[model]), "--port", str(PORT), "-c", "4096",
         "--jinja", "--log-disable", "-ngl", "99"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(600):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2) as r:
                if json.loads(r.read()).get("status") == "ok":
                    return proc
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.5)
    proc.kill()
    raise SystemExit(f"{model}: server did not start")


def ask(user: str) -> str:
    body = json.dumps({
        "messages": [{"role": "system", "content": e30.SYSTEM}, {"role": "user", "content": user}],
        "temperature": 0, "max_tokens": 200,
        "response_format": {"type": "json_object"},
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"] or ""


def rss_mb(pid: int) -> float:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {pid}).WorkingSet64"],
                         capture_output=True, text=True).stdout.strip()
    return round(int(out or 0) / 1e6, 1)


def check(model: str) -> None:
    e30.OUT.mkdir(exist_ok=True)
    out = e30.OUT / f"{model}.jsonl"
    done = {json.loads(l)["id"] for l in out.read_text(encoding="utf-8").splitlines() if l.strip()} if out.exists() else set()
    proc = start(model)
    try:
        first = []
        with out.open("a", encoding="utf-8") as f:
            for persona in e30.personas():
                facts = persona["control_facts"]
                for cand in persona["candidates"]:
                    if len(first) < 30:
                        first.append((facts, cand))
                    if cand["id"] in done:
                        continue
                    t0 = time.perf_counter()
                    verdict = e30.parse(ask(e30.prompt(facts, cand)))
                    verdict.update(id=cand["id"], ms=round((time.perf_counter() - t0) * 1000, 1))
                    f.write(json.dumps(verdict, ensure_ascii=False) + "\n")
                    f.flush()
        rows = {json.loads(l)["id"]: json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()}
        same = 0
        for facts, cand in first:
            again = e30.parse(ask(e30.prompt(facts, cand)))
            same += (again["violates"], again["fact"]) == (rows[cand["id"]]["violates"], rows[cand["id"]]["fact"])
        meta = {"determinism_same_of_30": same, "rss_mb": rss_mb(proc.pid),
                "file_gb": round((MODELS_DIR / MODELS[model]).stat().st_size / 1e9, 2)}
        (e30.OUT / f"{model}_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(model, meta)
    finally:
        proc.terminate()


def analyze() -> None:
    items = [(c, p) for p in e30.personas() for c in p["candidates"]]
    summary = {}
    for model in MODELS:
        path = e30.OUT / f"{model}.jsonl"
        if not path.exists():
            continue
        rows = {r["id"]: r for r in map(json.loads, path.read_text(encoding="utf-8").splitlines()) if r}
        if len(rows) < len(items):
            print(model, "incomplete", len(rows))
            continue
        s = e30.score(rows, items)
        s["gates"] = e30.gates(s)
        s["unparsed_pct"] = round(100 * s["unparsed"] / len(items), 1)
        meta = e30.OUT / f"{model}_meta.json"
        if meta.exists():
            s.update(json.loads(meta.read_text(encoding="utf-8")))
        summary[model] = s
    (e30.OUT / "summary_b.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    for k, v in summary.items():
        print(k, json.dumps(v, ensure_ascii=False))


if __name__ == "__main__":
    {"check": lambda: check(sys.argv[2]), "analyze": analyze}[sys.argv[1]]()
