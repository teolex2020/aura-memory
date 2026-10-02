"""E37: can memory learn from consequences what to keep? See PROTOCOL.md.

Plain Python 3 (no packages); GOOGLE_API_KEY in the
repository's .env (never printed); bge-m3 on local Ollama.
    python run.py embed     -> cache/embeddings.sqlite
    python run.py run       -> rows.jsonl (resumable per conversation and arm)
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
import sqlite3
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from array import array

HERE = Path(__file__).resolve().parent
DATA = Path(r"D:\Aura-clean\target\aura-local\external-benchmarks\locomo\locomo10.json")
DATA_SHA256 = "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4"
SEED = 37
PER_CONV = 40
CAPACITY_SHARE = 0.25
TOP_K = 10
MAX_CREDIT_TESTS = 3
ARMS = ("U", "R", "B", "D", "C")
MODEL = "gemini-3.1-flash-lite"
PRICE = (0.25, 1.50)
BUDGET_USD = 4.5
NEUTRAL = "You are a helpful assistant."
USED_INSTRUCTION = ("After your answer, add one last line 'USED: ' followed by the numbers of the memories "
                    "you used, comma-separated, or 'USED: none'.")


# The official LongMemEval judge prompts, taken from E20's file without
# importing it (E20 pulls in mem0 and the Aura package).
def _e20_judge():
    import ast
    src = (HERE.parent / "longmemeval_answers" / "run.py").read_text(encoding="utf-8")
    fn = next(n for n in ast.parse(src).body
              if isinstance(n, ast.FunctionDef) and n.name == "get_anscheck_prompt")
    scope: dict = {}
    exec(ast.get_source_segment(src, fn), scope)
    return scope["get_anscheck_prompt"]


get_anscheck_prompt = _e20_judge()


def _key_from_env() -> str:
    for line in (HERE.parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


KEY = _key_from_env()

(HERE / "cache").mkdir(exist_ok=True)

# ------------------------------------------------------------------ data


def load() -> list[dict]:
    digest = hashlib.sha256(DATA.read_bytes()).hexdigest()
    if digest != DATA_SHA256:
        raise SystemExit(f"LoCoMo hash mismatch: {digest}")
    return json.loads(DATA.read_text(encoding="utf-8"))


def turn_text(turn: dict, date: str) -> str:
    text = turn.get("text", "")
    if turn.get("blip_caption"):
        text += f" [shares a photo: {turn['blip_caption']}]"
    return f"[{date}] {turn['speaker']}: {text}"


def build(conv: dict) -> dict:
    c = conv["conversation"]
    sessions = []
    n = 1
    while f"session_{n}" in c:
        date = c.get(f"session_{n}_date_time", "")
        turns = [{"id": t["dia_id"], "text": turn_text(t, date)} for t in c[f"session_{n}"]]
        sessions.append({"index": n, "date": date, "turns": turns})
        n += 1
    session_of = {t["id"]: s["index"] for s in sessions for t in s["turns"]}

    def last_session(q):
        idx = []
        for ev in q.get("evidence", []):
            for part in re.split(r"[;,\s]+", str(ev)):
                if part in session_of:
                    idx.append(session_of[part])
        return max(idx) if idx else None

    pool = [q for q in conv["qa"] if q.get("category") in (1, 2, 3, 4) and last_session(q)]
    rng = random.Random(f"{SEED}-{conv['sample_id']}")
    picked = rng.sample(range(len(pool)), min(PER_CONV, len(pool)))
    questions = []
    for i in sorted(picked):
        q = pool[i]
        last = last_session(q)
        asked_after = rng.randint(last, len(sessions))
        questions.append({"qid": f"{conv['sample_id']}-{i}", "question": q["question"], "answer": str(q.get("answer", "")),
                          "category": q["category"], "after": asked_after,
                          "evidence": [p for ev in q.get("evidence", []) for p in re.split(r"[;,\s]+", str(ev)) if p in session_of]})
    # Stream order: by session, dataset order within a session.
    questions.sort(key=lambda q: q["after"])
    half = len(questions) // 2
    for k, q in enumerate(questions):
        q["half"] = "second" if k >= half else "first"
    turns_total = sum(len(s["turns"]) for s in sessions)
    return {"id": conv["sample_id"], "sessions": sessions, "questions": questions,
            "capacity": round(CAPACITY_SHARE * turns_total), "turns": turns_total}


def convs() -> list[dict]:
    return [build(c) for c in load()]

# ------------------------------------------------------------------ embeddings

_db_lock = threading.Lock()
_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _ollama(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["embeddings"]


def _unit(v: list[float]) -> array:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return array("f", (x / norm for x in v))


_vecs: dict[str, list[float]] = {}


def vec(text: str) -> list[float]:
    k = _key(text)
    if k in _vecs:
        return _vecs[k]
    with _db_lock:
        row = _db.execute("SELECT v FROM emb WHERE h=?", (k,)).fetchone()
    if row:
        v = array("f")
        v.frombytes(row[0])
    else:
        v = _unit(_ollama([text])[0])
        with _db_lock:
            _db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (k, v.tobytes()))
            _db.commit()
    _vecs[k] = v.tolist()
    return _vecs[k]


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def embed() -> None:
    texts = sorted({t["text"] for c in convs() for s in c["sessions"] for t in s["turns"]}
                   | {q["question"] for c in convs() for q in c["questions"]})
    todo = [t for t in texts if not _db.execute("SELECT 1 FROM emb WHERE h=?", (_key(t),)).fetchone()]
    for i in range(0, len(todo), 64):
        chunk = todo[i:i + 64]
        for t, v in zip(chunk, _ollama(chunk)):
            _db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (_key(t), _unit(v).tobytes()))
        _db.commit()
        print(json.dumps({"embedded": min(i + 64, len(todo)), "of": len(todo)}), flush=True)

# ------------------------------------------------------------------ Gemini

_lock = threading.Lock()
CACHE_PATH = HERE / "cache" / "gemini.jsonl"
_cache: dict[str, dict] = {}
if CACHE_PATH.exists():
    for line in CACHE_PATH.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            rec = json.loads(line)
            _cache[rec["k"]] = rec


def spent() -> float:
    total = 0.0
    with _lock:
        for c in _cache.values():
            u = c["usage"]
            total += u.get("promptTokenCount", 0) * PRICE[0] / 1e6
            total += (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
    return total


def gemini(system: str | None, user: str, max_out: int) -> dict:
    k = hashlib.sha256(json.dumps([MODEL, system, user, max_out]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _cache[k]
    if spent() > BUDGET_USD:
        raise SystemExit(f"budget ${BUDGET_USD} reached")
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": max_out}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    data = json.dumps(body).encode()
    for attempt in range(10):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=data, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")).strip(),
                   "usage": d.get("usageMetadata", {})}
            with _lock:
                _cache[k] = rec
                with CACHE_PATH.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return rec
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {err.code}: {err.read()[:300]!r}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("Gemini: retries exhausted")


def read(q: dict, date: str, memories: list[str]) -> tuple[str, list[int]]:
    context = "\n\n".join(f"[{i + 1}] {m}" for i, m in enumerate(memories)) or "(none)"
    prompt = (f"Current date: {date}\n\nRetrieved memories:\n\n{context}\n\n"
              f"Question: {q['question']}\n\n{USED_INSTRUCTION}")
    text = gemini(NEUTRAL, prompt, 512)["text"]
    used: list[int] = []
    m = re.search(r"USED:\s*(.*)\s*$", text, re.I)
    if m:
        used = [int(n) for n in re.findall(r"\d+", m.group(1))]
        text = text[:m.start()].strip()
    return text, used


def judge(q: dict, answer: str) -> bool:
    task = "temporal-reasoning" if q["category"] == 2 else "single-session-user"
    verdict = gemini(None, get_anscheck_prompt(task, q["question"], q["answer"], answer), 16)["text"]
    return verdict.strip().lower().startswith("yes")

# ------------------------------------------------------------------ stream


def score(arm: str, r: dict, t: int) -> float:
    if arm == "R":
        return r["t_created"]
    if arm == "B":
        return r["accesses"]
    d = math.exp(-(t - r["t_last"]) / (1 + r["accesses"]))
    return d + r["credits"] if arm == "C" else d


def run_conv(conv: dict, arm: str) -> list[dict]:
    store: dict[str, dict] = {}
    by_after: dict[int, list[dict]] = {}
    for q in conv["questions"]:
        by_after.setdefault(q["after"], []).append(q)
    rows = []
    credits_given = 0
    for s in conv["sessions"]:
        t = s["index"]
        for turn in s["turns"]:
            store[turn["id"]] = {"id": turn["id"], "text": turn["text"], "t_created": t, "t_last": t,
                                 "accesses": 0, "credits": 0, "v": vec(turn["text"])}
        if arm != "U" and len(store) > conv["capacity"]:
            ranked = sorted(store.values(), key=lambda r: (score(arm, r, t), r["t_created"]))
            for r in ranked[:len(store) - conv["capacity"]]:
                del store[r["id"]]
        for q in by_after.get(t, []):
            qv = vec(q["question"])
            top = sorted(store.values(), key=lambda r: -dot(r["v"], qv))[:TOP_K]
            for r in top:
                r["accesses"] += 1
                r["t_last"] = t
            texts = [r["text"] for r in top]
            answer, used = read(q, s["date"], texts)
            correct = judge(q, answer)
            if arm == "C" and correct:
                for n in [u for u in dict.fromkeys(used) if 1 <= u <= len(top)][:MAX_CREDIT_TESTS]:
                    without = texts[:n - 1] + texts[n:]
                    if not judge(q, read(q, s["date"], without)[0]):
                        top[n - 1]["credits"] += 1
                        credits_given += 1
            rows.append({"conv": conv["id"], "arm": arm, "qid": q["qid"], "category": q["category"],
                         "half": q["half"], "correct": correct,
                         "evidence_kept": (sum(e in store for e in q["evidence"]) / len(q["evidence"]))
                         if q["evidence"] else None,
                         "used": used, "credits_so_far": credits_given})
    return rows


def run() -> None:
    out = HERE / "rows.jsonl"
    done = set()
    if out.exists():
        for l in out.read_text(encoding="utf-8").split("\n"):
            if l.strip():
                r = json.loads(l)
                done.add((r["conv"], r["arm"]))
    cs = convs()
    jobs = [(c, a) for c in cs for a in ARMS if (c["id"], a) not in done]
    write = threading.Lock()

    def one(job):
        c, a = job
        rows = run_conv(c, a)
        with write, out.open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        acc = round(100 * sum(r["correct"] for r in rows) / len(rows), 1)
        print(json.dumps({"conv": c["id"], "arm": a, "acc": acc, "usd": round(spent(), 3)}), flush=True)

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one, jobs))

# ------------------------------------------------------------------ analysis


def pct(xs) -> float | None:
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def analyze() -> None:
    rows = [json.loads(l) for l in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    second = {a: pct(r["correct"] for r in rows if r["arm"] == a and r["half"] == "second") for a in ARMS}
    overall = {a: pct(r["correct"] for r in rows if r["arm"] == a) for a in ARMS}
    by_cat = {c: {a: pct(r["correct"] for r in rows if r["arm"] == a and r["category"] == c) for a in ARMS}
              for c in (1, 2, 3, 4)}
    kept = {a: round(100 * statistics.mean(r["evidence_kept"] for r in rows
                                           if r["arm"] == a and r["evidence_kept"] is not None), 1) for a in ARMS}
    kept_second = {a: round(100 * statistics.mean(r["evidence_kept"] for r in rows
                                                  if r["arm"] == a and r["half"] == "second"
                                                  and r["evidence_kept"] is not None), 1) for a in ARMS}
    credits = sum(max((r["credits_so_far"] for r in rows if r["arm"] == "C" and r["conv"] == c), default=0)
                  for c in {r["conv"] for r in rows})
    gates = {"G0": second["U"] >= second["R"] + 10,
             "G1": second["C"] >= second["D"] + 5,
             "G2": second["C"] > second["B"]}
    result = {"questions": len(rows) // len(ARMS), "gates": gates, "second_half_accuracy": second,
              "overall_accuracy": overall, "by_category": by_cat,
              "evidence_kept_percent": kept, "evidence_kept_second_half": kept_second,
              "credits_given": credits, "usd": round(spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"embed": embed, "run": run, "analyze": analyze}[sys.argv[1]]()
