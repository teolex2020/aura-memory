"""E46: can memory keep the newer fact when an old one conflicts? See PROTOCOL.md.

Run with E:\\remy\\app\\.venv (pyarrow, numpy) as a tool; bge-m3 on local
Ollama; GOOGLE_API_KEY in the repository's .env (never printed).
    python run.py embed     -> cache/embeddings.sqlite
    python run.py answer    -> cache/gemini.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import sqlite3
import string
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DATA = Path(r"E:\aura-benchmarks\ai-hyz__MemoryAgentBench\data\Conflict_Resolution-00000-of-00001.parquet")
CODE = Path(r"E:\aura-benchmarks\MemoryAgentBench-code")
MODEL = "gemini-3.1-flash-lite"
PRICE = (0.25, 1.50)
BUDGET_USD = 3.0
TOP_K, POOL = 10, 30
TAU = 0.92
SENSITIVITY = (0.88, 0.95)

(HERE / "cache").mkdir(exist_ok=True)

# ------------------------------------------------------------------ official template and metric


def _official():
    src = (CODE / "utils" / "templates.py").read_text(encoding="utf-8")
    scope: dict = {}
    exec(compile(src, "templates.py", "exec"), scope)  # plain dict literals
    template = scope["BASE_TEMPLATES"]["factconsolidation"]["query"]["rag_agent"]
    ev = (CODE / "utils" / "eval_other_utils.py").read_text(encoding="utf-8")
    fns = {n.name: n for n in ast.parse(ev).body if isinstance(n, ast.FunctionDef)}
    metric_scope = {"string": string, "re": re}
    for name in ("normalize_answer", "substring_exact_match_score"):
        exec(ast.get_source_segment(ev, fns[name]), metric_scope)
    return template, scope["SYSTEM_MESSAGE"], metric_scope["substring_exact_match_score"]


TEMPLATE, SYSTEM, SUB_EM = _official()

# ------------------------------------------------------------------ data

FACT = re.compile(r"^(\d+)\.\s+(.*)$")


def tasks() -> list[dict]:
    out = []
    for row in pq.read_table(DATA).to_pylist():
        name = row["metadata"]["qa_pair_ids"][0].rsplit("_no", 1)[0]  # e.g. factconsolidation_sh_32k
        facts = []
        for line in row["context"].split("\n"):
            m = FACT.match(line.strip())
            if m:
                facts.append((int(m.group(1)), line.strip()))
        out.append({"name": name, "hop": "sh" if "_sh_" in name else "mh", "size": name.rsplit("_", 1)[1],
                    "facts": facts, "questions": row["questions"], "answers": row["answers"]})
    return out

# ------------------------------------------------------------------ embeddings

_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")


def _h(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _ollama(texts):
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["embeddings"]


def embed() -> None:
    texts = sorted({t for task in tasks() for _, t in task["facts"]} | {q for task in tasks() for q in task["questions"]})
    todo = [t for t in texts if not _db.execute("SELECT 1 FROM emb WHERE h=?", (_h(t),)).fetchone()]
    for i in range(0, len(todo), 64):
        chunk = todo[i:i + 64]
        rows = []
        for t, v in zip(chunk, _ollama(chunk)):
            v = np.asarray(v, dtype=np.float32)
            rows.append((_h(t), (v / (np.linalg.norm(v) or 1.0)).tobytes()))
        _db.executemany("INSERT OR REPLACE INTO emb VALUES (?, ?)", rows)
        _db.commit()
        if (i // 64) % 100 == 0:
            print(json.dumps({"embedded": i + len(chunk), "of": len(todo)}), flush=True)
    print(json.dumps({"embedded_total": len(todo)}), flush=True)


def vecs(texts: list[str]) -> np.ndarray:
    out = []
    for t in texts:
        row = _db.execute("SELECT v FROM emb WHERE h=?", (_h(t),)).fetchone()
        out.append(np.frombuffer(row[0], dtype=np.float32))
    return np.stack(out)

# ------------------------------------------------------------------ retrieval


def retrieve(task: dict, mat: np.ndarray, q: str, arm: str, tau: float = TAU) -> list[int]:
    sims = mat @ vecs([q])[0]
    order = list(np.argsort(-sims))
    if arm == "R0":
        return order[:TOP_K]
    kept: list[int] = []
    for i in order[:POOL]:
        same = [k for k in kept if float(mat[i] @ mat[k]) >= tau]
        if not same:
            kept.append(i)
            continue
        k = same[0]
        if task["facts"][i][0] > task["facts"][k][0]:  # newer serial number wins the slot
            kept[kept.index(k)] = i
    return kept[:TOP_K]

# ------------------------------------------------------------------ reader

_lock = threading.Lock()
CACHE = HERE / "cache" / "gemini.jsonl"
_cache = {}
if CACHE.exists():
    for line in CACHE.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            _cache[r["k"]] = r


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


KEY = _key()


def spent() -> float:
    with _lock:
        return sum(c["usage"].get("promptTokenCount", 0) * PRICE[0] / 1e6
                   + (c["usage"].get("candidatesTokenCount", 0) + c["usage"].get("thoughtsTokenCount", 0)) * PRICE[1] / 1e6
                   for c in _cache.values())


def read(pool_text: str, question: str) -> str:
    user = f"[Knowledge Pool]\n{pool_text}\n\n" + TEMPLATE.format(question=question)
    k = hashlib.sha256(json.dumps([MODEL, SYSTEM, user]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _cache[k]["text"]
    if spent() > BUDGET_USD:
        raise SystemExit("budget reached")
    body = json.dumps({"systemInstruction": {"parts": [{"text": SYSTEM}]},
                       "contents": [{"role": "user", "parts": [{"text": user}]}],
                       "generationConfig": {"temperature": 0, "maxOutputTokens": 64}}).encode()
    for attempt in range(10):
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                     data=body, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "text": "".join(p.get("text", "") for p in parts), "usage": d.get("usageMetadata", {})}
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


def jobs():
    for task in tasks():
        mat = vecs([t for _, t in task["facts"]])
        for qi, q in enumerate(task["questions"]):
            for arm, tau in (("R0", TAU), ("S", TAU), ("S088", 0.88), ("S095", 0.95)):
                idx = retrieve(task, mat, q, "R0" if arm == "R0" else "S", tau)
                yield task, qi, arm, idx


def run_job(job) -> dict:
    task, qi, arm, idx = job
    pool_text = "\n".join(task["facts"][i][1] for i in idx)
    pred = read(pool_text, task["questions"][qi])
    golds = task["answers"][qi] if isinstance(task["answers"][qi], list) else [task["answers"][qi]]
    return {"name": task["name"], "hop": task["hop"], "size": task["size"], "q": qi, "arm": arm,
            "correct": any(SUB_EM(pred, str(g)) for g in golds),
            "gold_in_pool": any(str(g).lower() in pool_text.lower() for g in golds)}


def answer() -> None:
    rows = []
    with ThreadPoolExecutor(8) as ex:
        for n, r in enumerate(ex.map(run_job, jobs()), 1):
            rows.append(r)
            if n % 400 == 0:
                print(json.dumps({"answered": n, "usd": round(spent(), 3)}), flush=True)
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def analyze() -> None:
    rows = [json.loads(l) for l in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]

    def acc(rs):
        return round(100 * sum(r["correct"] for r in rs) / len(rs), 1) if rs else None

    table = {f"{hop}_{size}": {arm: acc([r for r in rows if r["hop"] == hop and r["size"] == size and r["arm"] == arm])
                               for arm in ("R0", "S", "S088", "S095")}
             for hop in ("sh", "mh") for size in ("6k", "32k", "64k", "262k")}
    gold = {arm: round(100 * sum(r["gold_in_pool"] for r in rows if r["arm"] == arm)
                       / sum(r["arm"] == arm for r in rows), 1) for arm in ("R0", "S")}

    def mean_diff(hop):
        ds = [table[f"{hop}_{s}"]["S"] - table[f"{hop}_{s}"]["R0"] for s in ("6k", "32k", "64k", "262k")]
        return round(sum(ds) / len(ds), 1)

    result = {"accuracy": table, "gold_answer_in_retrieved_percent": gold,
              "mean_S_minus_R0": {"sh": mean_diff("sh"), "mh": mean_diff("mh")},
              "gates": {"C1": mean_diff("sh") >= 10, "C2": mean_diff("mh") >= -2},
              "usd": round(spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"embed": embed, "answer": answer, "analyze": analyze}[sys.argv[1]]()
