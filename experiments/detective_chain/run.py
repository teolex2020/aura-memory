"""E52: a detective's chain on MemoryAgentBench FactConsolidation. See PROTOCOL.md. Test only.

Run with E:\\remy\\app\\.venv (pyarrow, numpy) as a tool; bge-m3 on local Ollama; GOOGLE_API_KEY in the
repository's .env (never printed). Reuses E46 (../stale_facts) for data, fact embeddings, template and metric.
    python run.py answer    -> rows.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
E46_DIR = HERE.parent / "stale_facts"
_spec = importlib.util.spec_from_file_location("e46", E46_DIR / "run.py")
e46 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e46)

MODEL = "gemini-3.1-flash-lite"
PRICE = (0.25, 1.50)
BUDGET_USD = 5.0
TOP_K = 10
MAX_STEPS = 5
SIZES = ("6k", "32k", "64k", "262k")
UNSUPPORTED = "unsupported"
(HERE / "cache").mkdir(exist_ok=True)

SYSTEM = ("You answer questions from a knowledge pool like a detective: every step of your reasoning must "
          "rest on one fact from the pool.")
STEP = """[Knowledge Pool]
{pool}

Rule: a larger serial number is a newer fact and overrides an older fact about the same thing.

Question: {question}
Chain so far:
{chain}

Do exactly one step. Reply with one JSON object only:
{{"link": {{"fact": <serial number of the fact you use>, "finding": "<the entity or value that fact gives>"}},
 "next": "<the next single-fact question to look up>"}}
or, when the chain answers the question:
{{"link": {{"fact": <serial>, "finding": "<answer>"}}, "final": "<concise answer>"}}"""
NEWER = """

Your step used fact #{serial}: "{text}".
Newer facts that may be about the same thing:
{candidates}
Rule: a larger serial number is newer and overrides an older fact about the same thing.
If one of these newer facts states the same relation with a different value, use the newest such fact instead.
Reply with the same JSON step format."""
NEIGHBOURS = 8
RETRY = "\n\nYour previous step cited fact #{fact}, but that fact does not state \"{finding}\". Cite a fact from the pool that states your finding."

# ------------------------------------------------------------------ query embeddings (own cache)

_qdb = sqlite3.connect(HERE / "cache" / "query_embeddings.sqlite", check_same_thread=False)
_qdb.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")
_qlock = threading.Lock()


def qvec(text: str) -> np.ndarray:
    h = e46._h(text)
    with _qlock:
        row = _qdb.execute("SELECT v FROM emb WHERE h=?", (h,)).fetchone()
    if row is None:
        with _qlock:  # one sqlite connection is shared by the worker threads
            row46 = e46._db.execute("SELECT v FROM emb WHERE h=?", (h,)).fetchone()  # original questions
        if row46 is not None:
            return np.frombuffer(row46[0], dtype=np.float32)
        v = np.asarray(e46._ollama([text])[0], dtype=np.float32)
        v = v / (np.linalg.norm(v) or 1.0)
        with _qlock:
            _qdb.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (h, v.tobytes()))
            _qdb.commit()
        return v
    return np.frombuffer(row[0], dtype=np.float32)

# ------------------------------------------------------------------ Gemini (own cache)

CACHE = HERE / "cache" / "gemini.jsonl"
_lock = threading.RLock()
_cache: dict[str, dict] = {}
if CACHE.exists():
    for line in CACHE.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            _cache[r["k"]] = r


class BudgetStop(Exception):
    pass


def spent() -> float:
    with _lock:
        return sum(c["usage"].get("promptTokenCount", 0) * PRICE[0] / 1e6
                   + (c["usage"].get("candidatesTokenCount", 0) + c["usage"].get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
                   for c in _cache.values())


def gemini(user: str) -> str:
    k = hashlib.sha256(json.dumps([MODEL, SYSTEM, user]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _cache[k]["text"]
    if spent() > BUDGET_USD:
        raise BudgetStop()
    body = json.dumps({"systemInstruction": {"parts": [{"text": SYSTEM}]},
                       "contents": [{"role": "user", "parts": [{"text": user}]}],
                       "generationConfig": {"temperature": 0, "maxOutputTokens": 256,
                                            "responseMimeType": "application/json"}}).encode()
    for attempt in range(10):
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                     data=body, headers={"x-goog-api-key": e46.KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")),
                   "usage": d.get("usageMetadata", {})}
            with _lock:
                _cache[k] = rec
                with CACHE.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return rec["text"]
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {err.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("retries exhausted")


def parse(text: str) -> dict:
    try:
        o = json.loads(text)
        if isinstance(o, list):
            o = next((x for x in o if isinstance(x, dict)), {})
        return o if isinstance(o, dict) else {}
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {}

# ------------------------------------------------------------------ the chain


def newer_neighbours(task: dict, mat: np.ndarray, serial: int) -> list[str]:
    """E52b: the records most similar to the cited one that are newer than it."""
    row_of = {s: i for i, (s, _) in enumerate(task["facts"])}
    i = row_of.get(serial)
    if i is None:
        return []
    order = [j for j in np.argsort(-(mat @ mat[i])) if j != i][:NEIGHBOURS]
    return [task["facts"][j][1] for j in order if task["facts"][j][0] > serial]


def run_chain(task: dict, mat: np.ndarray, question: str, verify: bool, newest: bool = False) -> dict:
    serial_of = [s for s, _ in task["facts"]]
    by_serial = {s: t for s, t in task["facts"]}
    changed = 0
    chain: list[tuple[int, str]] = []
    lookup = question
    shown_text = []
    final = None
    steps = 0
    for steps in range(1, MAX_STEPS + 1):
        sims = mat @ qvec(lookup)
        idx = list(np.argsort(-sims))[:TOP_K]
        shown = {serial_of[i] for i in idx}
        pool = "\n".join(task["facts"][i][1] for i in idx)
        shown_text.append(pool)
        chain_text = "\n".join(f"{n}. fact #{s}: {f}" for n, (s, f) in enumerate(chain, 1)) or "(none)"
        prompt = STEP.format(pool=pool, question=question, chain=chain_text)
        step = parse(gemini(prompt))
        link = step.get("link") if isinstance(step.get("link"), dict) else {}
        if newest:
            try:
                cited = int(link.get("fact"))
            except (TypeError, ValueError):
                cited = None
            cands = newer_neighbours(task, mat, cited) if cited in by_serial else []
            if cands:
                shown_text.append("\n".join(cands))
                again = parse(gemini(prompt + NEWER.format(serial=cited, text=by_serial[cited],
                                                           candidates="\n".join(cands))))
                new_link = again.get("link") if isinstance(again.get("link"), dict) else {}
                if new_link:
                    if str(new_link.get("fact")) != str(link.get("fact")):
                        changed += 1
                    step, link = again, new_link
        if verify:
            ok = _verified(link, shown, by_serial)
            if not ok:
                step = parse(gemini(prompt + RETRY.format(fact=link.get("fact"), finding=link.get("finding"))))
                link = step.get("link") if isinstance(step.get("link"), dict) else {}
                if not _verified(link, shown, by_serial):
                    return {"pred": UNSUPPORTED, "steps": steps, "chain": chain, "unsupported": True,
                            "pools": shown_text}
        finding = str(link.get("finding", "")).strip()
        try:
            serial = int(link.get("fact"))
        except (TypeError, ValueError):
            serial = -1
        chain.append((serial, finding))
        if step.get("final") is not None:
            final = str(step["final"]).strip()
            if verify:
                final = finding  # CV asserts only the verified finding
            break
        nxt = str(step.get("next") or "").strip()
        if not nxt:
            break
        lookup = nxt
    pred = final if final is not None else (chain[-1][1] if chain else "")
    return {"pred": pred, "steps": steps, "chain": chain, "unsupported": False, "pools": shown_text,
            "changed": changed}


def _verified(link: dict, shown: set[int], by_serial: dict[int, str]) -> bool:
    try:
        serial = int(link.get("fact"))
    except (TypeError, ValueError):
        return False
    finding = str(link.get("finding", "")).strip().lower()
    return bool(finding) and serial in shown and finding in by_serial.get(serial, "").lower()

# ------------------------------------------------------------------ jobs


def jobs(arms=("CH", "CV")) -> list:
    """Built in full before any worker starts, so the fact matrices are read from sqlite on one thread."""
    out = []
    for task in e46.tasks():
        mat = e46.vecs([t for _, t in task["facts"]])
        for qi in range(len(task["questions"])):
            for arm in arms:
                out.append((task, mat, qi, arm))
    return out


def run_job(job) -> dict | None:
    task, mat, qi, arm = job
    try:
        out = run_chain(task, mat, task["questions"][qi], verify=(arm == "CV"), newest=(arm == "CN"))
    except BudgetStop:
        return None
    golds = task["answers"][qi] if isinstance(task["answers"][qi], list) else [task["answers"][qi]]
    pools = "\n".join(out["pools"]).lower()
    return {"name": task["name"], "hop": task["hop"], "size": task["size"], "q": qi, "arm": arm,
            "pred": out["pred"], "steps": out["steps"], "chain": out["chain"], "unsupported": out["unsupported"],
            "changed": out.get("changed", 0),
            "correct": (not out["unsupported"]) and any(e46.SUB_EM(out["pred"], str(g)) for g in golds),
            "gold_seen": any(str(g).lower() in pools for g in golds)}


def answer() -> None:
    rows = []
    n = 0
    with ThreadPoolExecutor(8) as ex:
        for r in ex.map(run_job, jobs()):
            n += 1
            if r is not None:
                rows.append(r)
            if n % 200 == 0:
                print(json.dumps({"done": n, "usd": round(spent(), 3)}), flush=True)
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"rows": len(rows), "usd": round(spent(), 3)}))


def analyze() -> None:
    rows = [json.loads(x) for x in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    r0 = [json.loads(x) for x in (E46_DIR / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    rows += [dict(r, arm="R0") for r in r0 if r["arm"] == "R0"]

    def acc(rs):
        return round(100 * sum(r["correct"] for r in rs) / len(rs), 1) if rs else None

    table = {f"{hop}_{s}": {arm: acc([r for r in rows if r["hop"] == hop and r["size"] == s and r["arm"] == arm])
                            for arm in ("R0", "CH", "CV")} for hop in ("sh", "mh") for s in SIZES}

    def mean(hop, arm):
        vals = [table[f"{hop}_{s}"][arm] for s in SIZES]
        return round(sum(vals) / len(vals), 1) if None not in vals else None

    means = {hop: {arm: mean(hop, arm) for arm in ("R0", "CH", "CV")} for hop in ("sh", "mh")}
    cv = [r for r in rows if r["arm"] == "CV"]
    answered = [r for r in cv if not r["unsupported"]]
    extra = {
        "cv_unsupported_percent": {hop: round(100 * sum(r["unsupported"] for r in cv if r["hop"] == hop)
                                              / max(1, sum(r["hop"] == hop for r in cv)), 1) for hop in ("sh", "mh")},
        "cv_precision_percent": {hop: acc([r for r in answered if r["hop"] == hop]) for hop in ("sh", "mh")},
        "mean_steps": {arm: {hop: round(sum(r["steps"] for r in rows if r["arm"] == arm and r["hop"] == hop)
                                        / max(1, sum(r["arm"] == arm and r["hop"] == hop for r in rows)), 2)
                             for hop in ("sh", "mh")} for arm in ("CH", "CV")},
        "gold_seen_percent": {arm: {hop: round(100 * sum(r["gold_seen"] for r in rows if r["arm"] == arm and r["hop"] == hop)
                                               / max(1, sum(r["arm"] == arm and r["hop"] == hop for r in rows)), 1)
                                    for hop in ("sh", "mh")} for arm in ("CH", "CV")},
    }
    gates = {
        "D1": means["mh"]["CH"] is not None and means["mh"]["CH"] - means["mh"]["R0"] >= 15,
        "D2": means["sh"]["CH"] is not None and means["sh"]["CH"] - means["sh"]["R0"] >= -2,
        "D3": means["mh"]["CV"] is not None and means["mh"]["CV"] >= means["mh"]["CH"] - 3,
    }
    result = {"accuracy": table, "means": means, **extra, "gates": gates,
              "rows": {arm: sum(r["arm"] == arm for r in rows) for arm in ("R0", "CH", "CV")},
              "usd": round(spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=1, ensure_ascii=False))


def answer_b() -> None:
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for n, r in enumerate(ex.map(run_job, jobs(("CN",))), 1):
            if r is not None:
                rows.append(r)
            if n % 200 == 0:
                print(json.dumps({"done": n, "usd": round(spent(), 3)}), flush=True)
    (HERE / "rows_b.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + chr(10) for r in rows), encoding="utf-8")
    print(json.dumps({"rows": len(rows), "usd": round(spent(), 3)}))


def analyze_b() -> None:
    load = lambda p: [json.loads(x) for x in p.read_text(encoding="utf-8").split(chr(10)) if x.strip()]
    rows = [r for r in load(HERE / "rows.jsonl") if r["arm"] == "CH"] + load(HERE / "rows_b.jsonl")
    rows += [dict(r, arm="R0") for r in load(E46_DIR / "rows.jsonl") if r["arm"] == "R0"]

    def acc(rs):
        return round(100 * sum(r["correct"] for r in rs) / len(rs), 1) if rs else None

    arms = ("R0", "CH", "CN")
    table = {f"{hop}_{s}": {a: acc([r for r in rows if r["hop"] == hop and r["size"] == s and r["arm"] == a]) for a in arms}
             for hop in ("sh", "mh") for s in SIZES}
    means = {hop: {a: round(sum(table[f"{hop}_{s}"][a] for s in SIZES) / len(SIZES), 1) for a in arms} for hop in ("sh", "mh")}
    cn = [r for r in rows if r["arm"] == "CN"]
    mh = [r for r in cn if r["hop"] == "mh"]
    seen = [r for r in mh if r["gold_seen"]]
    result = {
        "accuracy": table, "means": means,
        "cn_links_changed_per_question": {hop: round(sum(r["changed"] for r in cn if r["hop"] == hop)
                                                     / max(1, sum(r["hop"] == hop for r in cn)), 3) for hop in ("sh", "mh")},
        "cn_mh_gold_seen_percent": round(100 * len(seen) / max(1, len(mh)), 1),
        "cn_mh_correct_when_seen_percent": round(100 * sum(r["correct"] for r in seen) / max(1, len(seen)), 1),
        "gates": {"N1": means["mh"]["CN"] - means["mh"]["CH"] >= 10, "N2": means["sh"]["CN"] - means["sh"]["CH"] >= -2},
        "rows": {a: sum(r["arm"] == a for r in rows) for a in arms},
        "usd_total_e52_e52b": round(spent(), 3),
    }
    (HERE / "results_b.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    {"answer": answer, "analyze": analyze, "answer_b": answer_b, "analyze_b": analyze_b}[sys.argv[1]]()
