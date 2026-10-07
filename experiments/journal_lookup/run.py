"""E56: user words in memory, AI replies from the journal only when asked about them. See PROTOCOL.md.

Test only. Run with target/ci-venv (aura built); bge-m3 on local Ollama; GOOGLE_API_KEY in the repo .env.
Reuses E35 (../capture_value) and, through it, E19/E20; mem0 (no longer installed) is stubbed.
    python run.py run       -> rows.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
E35_DIR = HERE.parent / "capture_value"


def _stub_mem0() -> None:
    """E19 imports mem0 at module level; these phases never use it."""
    class _Any:
        def __init__(self, *a, **k):
            pass

    class _Factory:
        provider_to_class: dict = {}

    names = {
        "mem0": {"Memory": _Any},
        "mem0.configs": {}, "mem0.configs.llms": {}, "mem0.configs.llms.base": {"BaseLlmConfig": _Any},
        "mem0.embeddings": {}, "mem0.embeddings.base": {"EmbeddingBase": _Any},
        "mem0.llms": {}, "mem0.llms.base": {"LLMBase": _Any},
        "mem0.utils": {}, "mem0.utils.factory": {"EmbedderFactory": type("EF", (_Factory,), {"provider_to_class": {}}),
                                                 "LlmFactory": type("LF", (_Factory,), {"provider_to_class": {}})},
    }
    for name, attrs in names.items():
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules.setdefault(name, mod)


_stub_mem0()
_spec = importlib.util.spec_from_file_location("e35", E35_DIR / "run.py")
e35 = importlib.util.module_from_spec(_spec)
sys.modules["e35"] = e35
_spec.loader.exec_module(e35)
e19, e20 = e35.e19, e35.e20

# Own cache and budget: E35's spending does not count here.
(HERE / "cache").mkdir(exist_ok=True)
e35.CACHE_PATH = HERE / "cache" / "gemini.jsonl"
e35._cache.clear()
if e35.CACHE_PATH.exists():
    for line in e35.CACHE_PATH.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            e35._cache[r["k"]] = r
e35.BUDGET_USD = 3.0

JOURNAL_K = 5
ROUTER = ("Question: {q}\n\nDoes this question ask about something the assistant said, suggested, explained or did "
          "in an earlier conversation, rather than about the user or the world? Answer yes or no only.")
JOURNAL_HEAD = ("Earlier assistant replies (from the conversation journal: what the AI said then, "
                "not established facts):")
TYPES = ("knowledge-update", "multi-session", "single-session-assistant", "single-session-preference",
         "single-session-user", "temporal-reasoning")


def cos(a, b) -> float:
    return sum(x * y for x, y in zip(a, b)) / ((math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1.0)


def journal_block(q: dict) -> str:
    replies = [(date, t["content"]) for _, date, s in e35.sessions(q) for t in s
               if t["role"] != "user" and t["content"].strip()]
    qv = e19.embed(q["question"])
    scored = sorted(replies, key=lambda dr: -cos(qv, e19.embed(dr[1])))[:JOURNAL_K]
    return JOURNAL_HEAD + "\n\n" + "\n\n---\n\n".join(f"[Session time: {d}]\nAssistant: {t}" for d, t in scored)


def prompt_with(q: dict, ranked: list[str], journal: str | None) -> str:
    base = e35.reader_prompt(q, "U", ranked)
    if journal is None:
        return base
    head, question = base.rsplit("\n\nQuestion: ", 1)
    return f"{head}\n\n{journal}\n\nQuestion: {question}"


def run_q(q: dict) -> list[dict]:
    retrieved = RETRIEVED[q["question_id"]]["U"]["ranked"]
    route = e35.gemini(None, ROUTER.format(q=q["question"]), 8)["text"].strip().lower().startswith("yes")
    journal = JOURNALS[q["question_id"]] if q["question_id"] in JOURNALS else journal_block(q)
    rows = []
    for arm, block in (("JR", journal if route else None), ("JA", journal)):
        prompt = prompt_with(q, retrieved, block)
        ans = e35.gemini(e35.NEUTRAL, prompt, 1024)["text"]
        v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], ans), 64)["text"]
        rows.append({"qid": q["question_id"], "type": q["question_type"], "arm": arm, "routed": route,
                     "correct": v.strip().lower().startswith("yes"), "answer": ans})
    return rows


RETRIEVED: dict = {}
JOURNALS: dict = {}


def run() -> None:
    global RETRIEVED
    RETRIEVED = e35.load_retrieved()
    # E19's embedding cache is one sqlite connection: build every journal block on this thread first.
    for q in e35.questions():
        JOURNALS[q["question_id"]] = journal_block(q)
    print(json.dumps({"journal_blocks": len(JOURNALS)}), flush=True)
    out = []
    with ThreadPoolExecutor(8) as ex:
        for n, rows in enumerate(ex.map(run_q, e35.questions()), 1):
            out.extend(rows)
            if n % 20 == 0:
                print(json.dumps({"questions": n, "usd": round(e35.spent(), 3)}), flush=True)
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    print(json.dumps({"rows": len(out), "usd": round(e35.spent(), 3)}))


def pct(xs) -> float:
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else 0.0


def analyze() -> None:
    rows = [json.loads(x) for x in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    old = [json.loads(x) for x in (E35_DIR / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    rows += [{"qid": r["qid"], "type": r["type"], "arm": r["arm"], "correct": r["correct"]}
             for r in old if r["arm"] in ("N", "U", "F")]
    arms = ("N", "U", "F", "JR", "JA")
    acc = {a: pct(r["correct"] for r in rows if r["arm"] == a) for a in arms}
    by_type = {t: {a: pct(r["correct"] for r in rows if r["arm"] == a and r["type"] == t) for a in arms} for t in TYPES}
    others = [t for t in TYPES if t != "single-session-assistant"]
    other_acc = {a: pct(r["correct"] for r in rows if r["arm"] == a and r["type"] in others) for a in arms}
    jr = [r for r in rows if r["arm"] == "JR"]
    router = {"recall_on_assistant_questions": pct(r["routed"] for r in jr if r["type"] == "single-session-assistant"),
              "yes_rate_on_other_types": pct(r["routed"] for r in jr if r["type"] in others)}
    gates = {"J1": acc["JR"] >= acc["F"] - 2,
             "J2": by_type["single-session-assistant"]["JR"] >= 80,
             "J3": other_acc["JR"] >= other_acc["U"] - 2}
    result = {"accuracy": acc, "by_type": by_type, "other_five_types": other_acc, "router": router,
              "gates": gates, "usd": round(e35.spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"run": run, "analyze": analyze}[sys.argv[1]]()
