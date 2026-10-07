"""E55: OSINT-style verification on AVeriTeC dev from a shared memory. See PROTOCOL.md. Test only.

Run with E:\\remy\\app\\.venv (numpy); bge-m3 on local Ollama; GOOGLE_API_KEY in the repo .env (never printed).
AVeriTeC (CC-BY-NC-4.0) is read from E:\\aura-benchmarks\\AVeriTeC\\dev.json.
    python run.py embed | run | analyze
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DATA = Path(r"E:\aura-benchmarks\AVeriTeC\dev.json")
MODELS = ("gemini-3.1-flash-lite", "gemini-2.5-flash")
PRICE = {"gemini-3.1-flash-lite": (0.25, 1.50), "gemini-2.5-flash": (0.30, 2.50)}
BUDGET_USD = 5.0
TOP_K, PER_Q = 10, 3
LABELS = ("Supported", "Refuted", "Not Enough Evidence", "Conflicting Evidence/Cherrypicking")
ARMS = ("N", "D", "DS", "O")
(HERE / "cache").mkdir(exist_ok=True)

DEFS = """Labels:
- "Supported": the evidence supports the claim.
- "Refuted": the evidence contradicts the claim.
- "Not Enough Evidence": the evidence does not decide it.
- "Conflicting Evidence/Cherrypicking": the evidence points both ways, or the claim is technically true but misleading."""
SYSTEM = "You are a careful fact-checker working from a memory of collected evidence."
PLAIN = """Claim: {claim}
{meta}
{evidence}
{defs}

Reply with JSON only: {{"verdict": "<one label>"}}"""
OSINT = """Claim: {claim}
{meta}
{evidence}
{defs}

Verify like an OSINT investigator. Do not accept the claim because someone said it or one article reports it.
1. {questions_instruction}
2. For each question, answer it from the evidence records, citing record numbers, or say "not found".
3. Count the independent sources (distinct source domains) behind the answers, and note if reports are copies of one another.
4. Only then decide the label.

Reply with JSON only:
{{"checks": [{{"question": "...", "answer": "...", "records": [<numbers>]}}],
 "independent_sources": <number>, "copies_noted": "<short note or empty>",
 "verdict": "<one label>"}}"""
ASK = """Claim: {claim}
{meta}

Before looking at any evidence: if this claim were true, what else would have to be true, or what would an
investigator check (time, place, other independent reports, records that must exist, who first published it)?
Write 3 to 5 short verification questions that can be looked up.

Reply with JSON only: {{"questions": ["...", "..."]}}"""

# ------------------------------------------------------------------ data and memory


def claims() -> list[dict]:
    return json.loads(DATA.read_text(encoding="utf-8"))


def domain(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
        if "web.archive.org" in host:  # archived copies: take the original host
            m = re.search(r"web\.archive\.org/web/\d+[a-z_]*/(https?://[^/]+)", url)
            host = urllib.parse.urlparse(m.group(1)).netloc.lower() if m else host
        return host.removeprefix("www.") or "unknown"
    except Exception:
        return "unknown"


def records() -> tuple[list[str], list[int]]:
    texts, owner = [], []
    for ci, c in enumerate(claims()):
        for q in c.get("questions", []):
            for a in q.get("answers", []):
                ans = (a.get("answer") or "").strip()
                if a.get("boolean_explanation"):
                    ans = f"{ans}. {a['boolean_explanation'].strip()}"
                if not ans:
                    continue
                texts.append(f"Q: {q['question'].strip()} A: {ans} (source: {domain(a.get('source_url', ''))})")
                owner.append(ci)
    return texts, owner


def meta_line(c: dict) -> str:
    parts = []
    if c.get("claim_date"):
        parts.append(f"Claim date: {c['claim_date']}")
    if c.get("speaker"):
        parts.append(f"Speaker: {c['speaker']}")
    return "; ".join(parts)

# ------------------------------------------------------------------ embeddings

_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")
_dblock = threading.Lock()


def _h(t: str) -> str:
    return hashlib.sha1(t.encode("utf-8")).hexdigest()


def _ollama(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["embeddings"]


def vec(texts: list[str]) -> np.ndarray:
    out = [None] * len(texts)
    todo = []
    with _dblock:
        for i, t in enumerate(texts):
            row = _db.execute("SELECT v FROM emb WHERE h=?", (_h(t),)).fetchone()
            if row:
                out[i] = np.frombuffer(row[0], dtype=np.float32)
            else:
                todo.append(i)
    for s in range(0, len(todo), 64):
        chunk = todo[s:s + 64]
        embs = _ollama([texts[i] for i in chunk])
        with _dblock:
            for i, v in zip(chunk, embs):
                v = np.asarray(v, dtype=np.float32)
                v = v / (np.linalg.norm(v) or 1.0)
                _db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (_h(texts[i]), v.tobytes()))
                out[i] = v
            _db.commit()
    return np.stack(out)


def embed() -> None:
    texts, _ = records()
    vec(texts)
    vec([c["claim"] for c in claims()])
    print(json.dumps({"records": len(texts)}))

# ------------------------------------------------------------------ Gemini


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


KEY = _key()
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
        return sum(c["usage"].get("promptTokenCount", 0) * PRICE[c["model"]][0] / 1e6
                   + (c["usage"].get("candidatesTokenCount", 0) + c["usage"].get("thoughtsTokenCount", 0))
                   * PRICE[c["model"]][1] / 1e6 for c in _cache.values())


def gemini(model: str, user: str, max_out: int = 1200) -> dict:
    k = hashlib.sha256(json.dumps([model, SYSTEM, user, max_out]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _parse(_cache[k]["text"])
    if spent() > BUDGET_USD:
        raise BudgetStop()
    config = {"temperature": 0, "maxOutputTokens": max_out, "responseMimeType": "application/json"}
    if model == "gemini-2.5-flash":
        config["thinkingConfig"] = {"thinkingBudget": 0}
    body = json.dumps({"systemInstruction": {"parts": [{"text": SYSTEM}]},
                       "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": config}).encode()
    for attempt in range(10):
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                     data=body, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "model": model, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")),
                   "usage": d.get("usageMetadata", {})}
            with _lock:
                _cache[k] = rec
                with CACHE.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return _parse(rec["text"])
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {err.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("retries exhausted")


def _parse(text: str) -> dict:
    try:
        o = json.loads(text)
        return o if isinstance(o, dict) else {}
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        try:
            return json.loads(m.group(0)) if m else {}
        except Exception:
            return {}


def norm_label(v) -> str:
    s = str(v or "").strip().lower()
    for lab in LABELS:
        if s == lab.lower():
            return lab
    if "conflict" in s or "cherry" in s:
        return LABELS[3]
    if "not enough" in s or "insufficient" in s:
        return LABELS[2]
    if "refut" in s or "false" in s:
        return LABELS[1]
    if "support" in s or "true" in s:
        return LABELS[0]
    return "INVALID"

# ------------------------------------------------------------------ arms

TEXTS: list[str] = []
OWNER: list[int] = []
MAT: np.ndarray | None = None


def setup() -> None:
    global TEXTS, OWNER, MAT
    TEXTS, OWNER = records()
    MAT = vec(TEXTS)


def evidence_block(idx: list[int]) -> str:
    return "Evidence records:\n" + "\n".join(f"[{n}] {TEXTS[i]}" for n, i in enumerate(idx, 1))


def top(q_vec: np.ndarray, k: int) -> list[int]:
    return [int(i) for i in np.argsort(-(MAT @ q_vec))[:k]]


def run_claim(ci_c) -> list[dict] | None:
    ci, c = ci_c
    meta = meta_line(c)
    own = {i for i, o in enumerate(OWNER) if o == ci}
    d_idx = top(vec([c["claim"]])[0], TOP_K)
    rows = []
    try:
        for model in MODELS:
            out = {}
            out["N"] = (gemini(model, PLAIN.format(claim=c["claim"], meta=meta, evidence="(no evidence available)",
                                                   defs=DEFS), 100), [])
            ev = evidence_block(d_idx)
            out["D"] = (gemini(model, PLAIN.format(claim=c["claim"], meta=meta, evidence=ev, defs=DEFS), 100), d_idx)
            out["DS"] = (gemini(model, OSINT.format(claim=c["claim"], meta=meta, evidence=ev, defs=DEFS,
                                                    questions_instruction="Write 3 to 5 verification questions: what would have to be true, or what an investigator would check, if the claim were true.")),
                         d_idx)
            qs = [str(q) for q in (gemini(model, ASK.format(claim=c["claim"], meta=meta), 400).get("questions") or [])][:5]
            ranked: dict[int, int] = {}
            if qs:
                qv = vec(qs)
                for row in qv:
                    for rank, i in enumerate(top(row, PER_Q)):
                        ranked[i] = min(ranked.get(i, 99), rank)
            o_idx = sorted(ranked, key=lambda i: (ranked[i], i))[:TOP_K] or d_idx
            q_text = "Use these verification questions:\n" + "\n".join(f"- {q}" for q in qs) if qs else \
                "Write 3 to 5 verification questions."
            out["O"] = (gemini(model, OSINT.format(claim=c["claim"], meta=meta, evidence=evidence_block(o_idx), defs=DEFS,
                                                   questions_instruction=q_text)), o_idx)
            for arm, (resp, idx) in out.items():
                rows.append({"i": ci, "model": model, "arm": arm, "gold": c["label"],
                             "pred": norm_label(resp.get("verdict")),
                             "recall": (len(own & set(idx)) / len(own)) if own and idx else None,
                             "n_sources": resp.get("independent_sources"), "questions": qs if arm == "O" else None})
    except BudgetStop:
        return None
    return rows


def run() -> None:
    setup()
    (HERE / "results").mkdir(exist_ok=True)
    rows = []
    with ThreadPoolExecutor(6) as ex:
        for n, rs in enumerate(ex.map(run_claim, enumerate(claims())), 1):
            if rs:
                rows.extend(rs)
            if n % 50 == 0:
                print(json.dumps({"claims": n, "usd": round(spent(), 3)}), flush=True)
    (HERE / "results" / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
                                                  encoding="utf-8")
    print(json.dumps({"rows": len(rows), "usd": round(spent(), 3)}))


def f1s(rs) -> dict:
    out = {}
    for lab in LABELS:
        tp = sum(r["pred"] == lab and r["gold"] == lab for r in rs)
        fp = sum(r["pred"] == lab and r["gold"] != lab for r in rs)
        fn = sum(r["pred"] != lab and r["gold"] == lab for r in rs)
        p = tp / (tp + fp) if tp + fp else 0.0
        rcl = tp / (tp + fn) if tp + fn else 0.0
        out[lab] = round(100 * (2 * p * rcl / (p + rcl) if p + rcl else 0.0), 1)
    return out


def summary(rs) -> dict:
    f = f1s(rs)
    not_sup = [r for r in rs if r["gold"] != "Supported"]
    rec = [r["recall"] for r in rs if r["recall"] is not None]
    return {"n": len(rs), "accuracy": round(100 * sum(r["pred"] == r["gold"] for r in rs) / len(rs), 1),
            "macro_f1": round(sum(f.values()) / len(f), 1), "f1": f,
            "false_support": round(100 * sum(r["pred"] == "Supported" for r in not_sup) / max(1, len(not_sup)), 1),
            "evidence_recall": round(100 * sum(rec) / len(rec), 1) if rec else None,
            "invalid": sum(r["pred"] == "INVALID" for r in rs)}


def analyze() -> None:
    rows = [json.loads(x) for x in (HERE / "results" / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    res = {"pooled": {a: summary([r for r in rows if r["arm"] == a]) for a in ARMS},
           "by_model": {m: {a: summary([r for r in rows if r["arm"] == a and r["model"] == m]) for a in ARMS} for m in MODELS},
           "gold_distribution": dict(Counter(r["gold"] for r in rows if r["arm"] == "N" and r["model"] == MODELS[0]))}
    p = res["pooled"]
    res["gates"] = {"O1": p["O"]["macro_f1"] - p["D"]["macro_f1"] >= 5,
                    "O2": (p["O"]["evidence_recall"] or 0) >= (p["D"]["evidence_recall"] or 0) + 10,
                    "O3": p["O"]["false_support"] <= 0.75 * p["D"]["false_support"]}
    res["usd"] = round(spent(), 3)
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"embed": embed, "run": run, "analyze": analyze}[sys.argv[1]]()
