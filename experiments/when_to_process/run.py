"""E60: when should the analytical processor switch on? See PROTOCOL.md. Test only.

Reuses E46/E52b (FactConsolidation), E35/E56/E59 (LongMemEval) and E58 (owner's messages, local only).
GOOGLE_API_KEY in the repo .env (never printed). Local router: qwen3:4b-instruct in Ollama.
    python run.py fc        (E:\\remy\\app\\.venv: pyarrow, numpy) -> rows_fc.jsonl
    python run.py lme       (target/ci-venv: aura)                 -> rows_lme.jsonl
    python run.py owner     (target/ci-venv: aura)                 -> private/rows_owner.jsonl
    python run.py analyze                                          -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import re
import statistics
import sys
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
PRIVATE = HERE / "private"
(HERE / "cache").mkdir(exist_ok=True)
PRIVATE.mkdir(exist_ok=True)
LOCAL = "qwen3:4b-instruct"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _own_cache(mod, attr: str, file: str, budget: float) -> None:
    setattr(mod, attr, HERE / "cache" / file)
    mod._cache.clear()
    path = getattr(mod, attr)
    if path.exists():
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                r = json.loads(line)
                mod._cache[r["k"]] = r
    mod.BUDGET_USD = budget

# ------------------------------------------------------------------ local routers (own cache)

L = """Message to an assistant that remembers earlier conversations:
{msg}

To answer it from memory, would the assistant need to combine two or more separate facts in a chain, or decide which of several versions of a fact is the newest? Answer only yes or no."""
LM = """Message to an assistant:
{msg}

Memories the assistant found:
{mem}

Do these memories hold several versions of the same fact (an older one updated by a newer one), or does answering need a chain of two or more of these facts? Answer only yes or no."""

_local_lock = threading.Lock()
LOCAL_CACHE = HERE / "cache" / "local.jsonl"
_local: dict = {}
if LOCAL_CACHE.exists():
    for line in LOCAL_CACHE.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            _local[r["k"]] = r


def local(prompt: str) -> dict:
    """{'yes': bool, 'ms': int}; ms is measured on the first (uncached) call."""
    with _local_lock:
        if prompt in _local:
            return _local[prompt]
    body = json.dumps({"model": LOCAL, "prompt": prompt, "stream": False,
                       "options": {"temperature": 0, "num_predict": 4, "num_ctx": 8192}}).encode()
    t0 = time.perf_counter()
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=body, headers={"Content-Type": "application/json"})
    out = json.loads(urllib.request.urlopen(req, timeout=600).read())["response"].strip().lower()
    rec = {"k": prompt, "yes": out.startswith("yes"), "ms": round(1000 * (time.perf_counter() - t0))}
    with _local_lock:
        _local[prompt] = rec
        with LOCAL_CACHE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def mem_lines(texts: list[str]) -> str:
    return "\n".join(f"- {t[:400]}" for t in texts) or "(none)"


ESC = ('\n\nReply with one JSON object only: {{"answer": "<very concise answer>", "escalate": true or false}}. '
       'Set "escalate" to true when the answer needs a chain of two or more facts, when the {what} hold different '
       'versions of the same fact, or when the {what} are not enough to answer.')


def parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        o = json.loads(m.group(0)) if m else {}
    except Exception:
        o = {}
    return o if isinstance(o, dict) else {}

# ------------------------------------------------------------------ FactConsolidation


def fc() -> None:
    e52 = _load("e52", EXP / "detective_chain" / "run.py")
    e46 = e52.e46
    _own_cache(e52, "CACHE", "gemini_fc.jsonl", 1.6)
    e52.SYSTEM = e46.SYSTEM  # S is the plain reader with an escalate flag, not the chain
    jobs = []
    for task in e46.tasks():  # retrieval on the main thread (sqlite)
        mat = e46.vecs([t for _, t in task["facts"]])
        for qi, q in enumerate(task["questions"]):
            idx = e46.retrieve(task, mat, q, "R0")
            jobs.append((task, qi, [task["facts"][i][1] for i in idx]))

    def one(job) -> dict:
        task, qi, facts = job
        q = task["questions"][qi]
        golds = task["answers"][qi] if isinstance(task["answers"][qi], list) else [task["answers"][qi]]
        pool = "\n".join(facts)
        s = parse_json(e52.gemini(f"[Knowledge Pool]\n{pool}\n\n" + e46.TEMPLATE.format(question=q) + ESC.format(what="facts in the pool")))
        lr, lmr = local(L.format(msg=q)), local(LM.format(msg=q, mem=mem_lines(facts)))
        return {"name": task["name"], "hop": task["hop"], "size": task["size"], "q": qi,
                "L": lr["yes"], "L_ms": lr["ms"], "LM": lmr["yes"], "LM_ms": lmr["ms"],
                "S_escalate": s.get("escalate") is True,
                "S_correct": any(e46.SUB_EM(str(s.get("answer", "")), str(g)) for g in golds)}

    out = []
    with ThreadPoolExecutor(4) as ex:
        for n, r in enumerate(ex.map(one, jobs), 1):
            out.append(r)
            if n % 100 == 0:
                print(json.dumps({"fc": n, "usd": round(e52.spent(), 3)}), flush=True)
    (HERE / "rows_fc.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out), encoding="utf-8")

# ------------------------------------------------------------------ LongMemEval


def lme() -> None:
    e59 = _load("e59", EXP / "memory_vs_context" / "run.py")
    e59._lme_modules()
    e35, e20 = e59.e35, e59.e20
    _own_cache(e35, "CACHE_PATH", "gemini_lme.jsonl", 0.4)
    retrieved = e35.load_retrieved()

    def one(q: dict) -> dict:
        ranked = retrieved[q["question_id"]]["U"]["ranked"]
        prompt = e35.reader_prompt(q, "U", ranked) + ESC.format(what="memories")
        s = parse_json(e35.gemini(e35.NEUTRAL, prompt, 1024)["text"])
        v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], str(s.get("answer", ""))), 64)["text"]
        lr = local(L.format(msg=q["question"]))
        lmr = local(LM.format(msg=q["question"], mem=mem_lines(ranked)))
        return {"qid": q["question_id"], "type": q["question_type"], "L": lr["yes"], "L_ms": lr["ms"],
                "LM": lmr["yes"], "LM_ms": lmr["ms"], "S_escalate": s.get("escalate") is True,
                "S_correct": v.strip().lower().startswith("yes")}

    e59.e35 = e35
    with ThreadPoolExecutor(4) as ex:
        out = list(ex.map(one, e59.lme_questions()))
    (HERE / "rows_lme.jsonl").write_text("".join(json.dumps(r) + "\n" for r in out), encoding="utf-8")
    print(json.dumps({"lme": len(out), "usd": round(e35.spent(), 3)}))

# ------------------------------------------------------------------ the owner's messages (local only)


def owner() -> None:
    e58 = _load("e58", EXP / "real_sessions_tiers" / "run.py")
    labels = [json.loads(x) for x in (EXP / "real_sessions_tiers" / "private" / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    ps = e58.prompts()[:len(labels)]
    assert all(len(p["text"]) == r["len"] for p, r in zip(ps, labels)), "journal no longer matches E58's rows"
    rows = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        brain = e58.Aura(str(Path(d) / "aura"))
        brain.set_embedding_fn(e58.embed)
        session_of: dict[str, str] = {}
        for i, p in enumerate(ps):
            hits = brain.recall_structured(p["text"], top_k=15) if i else []
            other = [h["content"] for h in hits if session_of.get(h["content"]) != p["session"]][:10]
            lr = local(L.format(msg=p["text"][:1500]))
            lmr = local(LM.format(msg=p["text"][:1500], mem=mem_lines(other)))
            rows.append({"i": i, "needs_past": labels[i]["needs_past"], "L": lr["yes"], "L_ms": lr["ms"],
                         "LM": lmr["yes"], "LM_ms": lmr["ms"]})
            brain.store(p["text"], level=e58.Level.Domain, channel=f"user-{p['client'] or 'unknown'}", deduplicate=False)
            session_of[p["text"]] = p["session"]
        brain.close()
    (PRIVATE / "rows_owner.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"owner": len(rows)}))

# ------------------------------------------------------------------ analysis


def load(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").split("\n") if x.strip()]


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def usd(file: str) -> float:
    path = HERE / "cache" / file
    if not path.exists():
        return 0.0
    tot = 0.0
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            u = json.loads(line).get("usage", {})
            tot += u.get("promptTokenCount", 0) * 0.25 / 1e6 + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * 1.5 / 1e6
    return round(tot, 3)


def analyze() -> None:
    key = lambda r: (r["name"], r["q"])
    r0 = {key(r): r["correct"] for r in load(EXP / "stale_facts" / "rows.jsonl") if r["arm"] == "R0"}
    cn = {key(r): r for r in load(EXP / "detective_chain" / "rows_b.jsonl")}
    fcr = load(HERE / "rows_fc.jsonl")
    for r in fcr:
        r["R0"], r["CN"], r["CN_calls"] = r0[key(r)], cn[key(r)]["correct"], 2 * cn[key(r)]["steps"]

    def route(r, name):
        """(correct, calls, fired) for one question under a router."""
        if name == "never":
            return r["R0"], 1, False
        if name == "always":
            return r["CN"], r["CN_calls"], True
        if name == "oracle":
            fire = (not r["R0"]) and r["CN"]
            return (r["CN"] if fire else r["R0"]), (r["CN_calls"] if fire else 1), fire
        if name in ("L", "LM"):
            return (r["CN"], r["CN_calls"], True) if r[name] else (r["R0"], 1, False)
        if name == "S":
            return (r["CN"], 1 + r["CN_calls"], True) if r["S_escalate"] else (r["S_correct"], 1, False)

    routers = ("never", "always", "oracle", "L", "LM", "S")
    fc_res = {}
    for name in routers:
        out = [route(r, name) for r in fcr]
        fc_res[name] = {"accuracy": pct(c for c, _, _ in out),
                        "fires": pct(f for _, _, f in out),
                        "calls_mean": round(statistics.mean(n for _, n, _ in out), 2)}
        for hop in ("sh", "mh"):
            sub = [route(r, name) for r in fcr if r["hop"] == hop]
            fc_res[name][hop] = {"accuracy": pct(c for c, _, _ in sub), "fires": pct(f for _, _, f in sub)}
    fc_res["S_own_answer_accuracy"] = {hop: pct(r["S_correct"] for r in fcr if r["hop"] == hop) for hop in ("sh", "mh")}
    gain = fc_res["always"]["accuracy"] - fc_res["never"]["accuracy"]

    lrows = load(HERE / "rows_lme.jsonl")
    e35_u = {r["qid"]: r["correct"] for r in load(EXP / "capture_value" / "rows.jsonl") if r["arm"] == "U"}
    lme_res = {"questions": len(lrows), "S_own_answer_accuracy": pct(r["S_correct"] for r in lrows),
               "C_accuracy": pct(e35_u[r["qid"]] for r in lrows)}
    for name, field in (("L", "L"), ("LM", "LM"), ("S", "S_escalate")):
        lme_res[name] = {"fires": pct(r[field] for r in lrows),
                         "C_accuracy_when_fired": pct(e35_u[r["qid"]] for r in lrows if r[field]),
                         "C_accuracy_when_not": pct(e35_u[r["qid"]] for r in lrows if not r[field]),
                         "by_type": {t: pct(r[field] for r in lrows if r["type"] == t) for t in sorted({r["type"] for r in lrows})}}

    orows = load(PRIVATE / "rows_owner.jsonl") if (PRIVATE / "rows_owner.jsonl").exists() else []
    own_res = {"messages": len(orows), "needs_past": sum(r["needs_past"] for r in orows)}
    for name in ("L", "LM"):
        own_res[name] = {"fires": pct(r[name] for r in orows),
                         "fires_when_needs_past": pct(r[name] for r in orows if r["needs_past"]),
                         "fires_when_not": pct(r[name] for r in orows if not r["needs_past"])}

    # timed on the owner set, which runs one call at a time (the other sets run 4 in parallel and queue in Ollama)
    ms = {name: statistics.median([r[f"{name}_ms"] for r in orows]) if orows else None for name in ("L", "LM")}
    res = {"factconsolidation": fc_res, "longmemeval": lme_res, "owner": own_res, "local_ms_median": ms}
    res["hypotheses"] = {}
    for name in ("L", "LM", "S"):
        w1 = fc_res[name]["accuracy"] - fc_res["never"]["accuracy"] >= 0.9 * gain
        w2 = lme_res[name]["fires"] <= 20 and (name == "S" or (own_res[name]["fires"] or 0) <= 20)
        res["hypotheses"][name] = {"W1_keeps_90pct_gain": w1, "W2_quiet_elsewhere": w2,
                                   "gain_kept_pct": round(100 * (fc_res[name]["accuracy"] - fc_res["never"]["accuracy"]) / gain, 1)}
    res["hypotheses"]["W1_and_W2_some_router"] = any(v["W1_keeps_90pct_gain"] and v["W2_quiet_elsewhere"]
                                                     for k, v in res["hypotheses"].items() if isinstance(v, dict))
    res["hypotheses"]["W3_local_under_1s"] = {k: v is not None and v <= 1000 for k, v in ms.items()}
    res["usd"] = {"fc": usd("gemini_fc.jsonl"), "lme": usd("gemini_lme.jsonl")}
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"fc": fc, "lme": lme, "owner": owner, "analyze": analyze}[sys.argv[1]]()
