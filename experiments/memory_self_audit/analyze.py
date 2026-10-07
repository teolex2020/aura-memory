"""Self-audit of the owner's Aura memory: patterns and anomalies. Local only, no external API.

Input: private/records.json (export_json of a copy of %APPDATA%/Aura/memory).
Output: private/details.json and printed aggregates. The private folder is gitignored; nothing
from the records' content leaves the machine. Run with E:\\remy\\app\\.venv (numpy); bge-m3 on
local Ollama for topic groups.
"""

from __future__ import annotations

import ast
import collections
import datetime as dt
import hashlib
import json
import re
import statistics
import sys
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PRIVATE = HERE / "private"
DAY = 86400.0


def lit(v):
    """export_json stringifies some fields; turn them back into Python values."""
    if isinstance(v, str):
        try:
            return ast.literal_eval(v)
        except Exception:
            return v
    return v


def load() -> list[dict]:
    raw = json.loads((PRIVATE / "records.json").read_text(encoding="utf-8"))
    out = []
    for r in raw:
        r = {k: lit(v) if k != "content" else v for k, v in r.items()}
        r["metadata"] = r.get("metadata") or {}
        r["tags"] = r.get("tags") or []
        out.append(r)
    return out


APP_MARKUP = re.compile(r"<(task-notification|system-reminder|pasted_content|local-command-[a-z]+|command-(?:name|message|args)|"
                        r"bash-(?:input|stdout|stderr)|agent-message|ci-monitor-event)\b")
IMAGE_LINE = re.compile(r"^\s*\[Image: source:.*\]\s*$", re.M)
SECRETS = {
    "openai_like_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "google_api_key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    "slack_token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "long_hex_token": re.compile(r"\b[0-9a-f]{40,}\b"),
    "private_key_block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "password_assignment": re.compile(r"(?i)\b(password|passwd|pwd)\s*[:=]\s*\S{4,}"),
}
PERSONAL = {
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    "phone": re.compile(r"(?<!\d)\+?\d[\d ()-]{8,}\d(?!\d)"),
    "windows_user_path": re.compile(r"(?i)C:[\\/]+Users[\\/]+[^\\/\s]+"),
    "url": re.compile(r"https?://\S+"),
}


def script_share(text: str) -> tuple[int, int]:
    cyr = sum(1 for c in text if "\u0400" <= c <= "\u04ff")
    lat = sum(1 for c in text if c.isascii() and c.isalpha())
    return cyr, lat


def ollama_embed(texts: list[str]) -> np.ndarray:
    vecs = []
    for i in range(0, len(texts), 32):
        body = json.dumps({"model": "bge-m3", "input": texts[i:i + 32], "truncate": True}).encode()
        req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body,
                                     headers={"Content-Type": "application/json"})
        vecs += json.loads(urllib.request.urlopen(req, timeout=900).read())["embeddings"]
    m = np.asarray(vecs, dtype=np.float32)
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def kmeans(m: np.ndarray, k: int, seed: int = 57, iters: int = 50) -> np.ndarray:
    rng = np.random.default_rng(seed)
    centers = m[rng.choice(len(m), k, replace=False)]
    for _ in range(iters):
        labels = np.argmax(m @ centers.T, axis=1)
        new = np.stack([m[labels == j].mean(axis=0) if (labels == j).any() else centers[j] for j in range(k)])
        new /= np.maximum(np.linalg.norm(new, axis=1, keepdims=True), 1e-9)
        if np.allclose(new, centers):
            break
        centers = new
    return labels


WORD = re.compile(r"[^\W\d_]{4,}", re.U)


def top_terms(texts: list[str], all_texts: list[str], n: int = 6) -> list[str]:
    """Most over-represented words of a group against the whole memory (no stop list: frequency ratio)."""
    def counts(ts):
        c = collections.Counter()
        for t in ts:
            c.update(set(w.lower() for w in WORD.findall(t)))
        return c
    g, a = counts(texts), counts(all_texts)
    scored = [(g[w] / len(texts)) / ((a[w] + 1) / len(all_texts)) * min(g[w], 5) for w in g]
    ranked = sorted(zip(g, scored), key=lambda x: -x[1])
    return [w for w, _ in ranked if g[w] >= 2][:n]


def main() -> None:
    rs = load()
    now = max(r["created_at"] for r in rs)
    d: dict = {"records": len(rs)}
    d["by_source_type"] = dict(collections.Counter(r["source_type"] for r in rs))
    d["by_level"] = dict(collections.Counter(r["level"] for r in rs))
    d["by_client"] = dict(collections.Counter(r["metadata"].get("client", "(none)") for r in rs))
    d["by_tag"] = dict(collections.Counter(t for r in rs for t in r["tags"]))
    d["by_namespace"] = dict(collections.Counter(r["namespace"] for r in rs))
    d["by_semantic_type"] = dict(collections.Counter(r["semantic_type"] for r in rs))
    d["pinned"] = sum(bool(r["pinned"]) for r in rs)
    d["metadata_source_vs_source_type"] = dict(collections.Counter(
        f"{r['metadata'].get('source', '(none)')} -> {r['source_type']}" for r in rs))
    d["metadata_keys"] = dict(collections.Counter(k for r in rs for k in r["metadata"]))

    # time
    days = collections.Counter(dt.datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d") for r in rs)
    hours = collections.Counter(dt.datetime.fromtimestamp(r["created_at"]).hour for r in rs)
    d["per_day"] = dict(sorted(days.items()))
    d["per_hour"] = {h: hours.get(h, 0) for h in range(24)}
    conv = [r for r in rs if "conversation" in r["tags"]]
    d["conversation_overdue"] = sum(1 for r in conv if r["level"] == "Working" and not r["pinned"]
                                    and now - r["created_at"] > 14 * DAY)
    d["oldest_days"] = round((now - min(r["created_at"] for r in rs)) / DAY, 1)

    # size and triviality
    lens = [len(r["content"]) for r in rs]
    d["length"] = {"median": statistics.median(lens), "p90": sorted(lens)[int(0.9 * len(lens)) - 1],
                   "max": max(lens), "over_2000": sum(l > 2000 for l in lens), "total_chars": sum(lens)}
    rec = [r for r in rs if r["source_type"] == "recorded"]
    d["recorded_trivial"] = {"<=20_chars": sum(len(r["content"].strip()) <= 20 for r in rec),
                             "<=3_words": sum(len(r["content"].split()) <= 3 for r in rec), "of": len(rec)}

    # anomalies
    markup = collections.Counter()
    for r in rs:
        for m in APP_MARKUP.finditer(r["content"]):
            markup[(r["source_type"], m.group(1))] += 1
        if IMAGE_LINE.search(r["content"]):
            markup[(r["source_type"], "[Image: source]")] += 1
    d["app_markup_in_records"] = {f"{st}:{tag}": n for (st, tag), n in markup.items()}
    d["records_with_app_markup"] = sum(1 for r in rs if APP_MARKUP.search(r["content"]) or IMAGE_LINE.search(r["content"]))
    norm = collections.Counter(re.sub(r"\s+", " ", r["content"].strip().lower()) for r in rs)
    d["exact_duplicate_groups"] = sum(1 for c in norm.values() if c > 1)
    d["exact_duplicate_records"] = sum(c - 1 for c in norm.values() if c > 1)
    d["secrets"] = {k: sum(1 for r in rs if p.search(r["content"])) for k, p in SECRETS.items()}
    d["personal"] = {k: sum(1 for r in rs if p.search(r["content"])) for k, p in PERSONAL.items()}
    cyr = lat = 0
    for r in rs:
        c, l = script_share(r["content"])
        cyr, lat = cyr + c, lat + l
    d["letters_cyrillic_share"] = round(cyr / max(1, cyr + lat), 3)
    d["activation"] = {"never": sum(1 for r in rs if not r["activation_count"]),
                       "max": max(r["activation_count"] for r in rs),
                       "mean": round(statistics.mean(r["activation_count"] for r in rs), 2)}
    deg = [len(r.get("connections") or {}) for r in rs]
    d["connections"] = {"isolated": sum(x == 0 for x in deg), "median_degree": statistics.median(deg), "max_degree": max(deg)}
    d["future_or_bad_time"] = sum(1 for r in rs if r["created_at"] > now + 60 or r["created_at"] < 1.7e9)

    # near duplicates and topics (local embeddings)
    texts = [r["content"][:2000] for r in rs]
    m = ollama_embed(texts)
    sim = m @ m.T
    np.fill_diagonal(sim, 0)
    near = [(i, j) for i in range(len(rs)) for j in range(i + 1, len(rs)) if sim[i, j] >= 0.95]
    d["near_duplicate_pairs_0.95"] = len(near)
    k = 8 if len(rs) >= 80 else max(2, len(rs) // 10)
    labels = kmeans(m, k)
    groups = []
    for j in range(k):
        idx = [i for i in range(len(rs)) if labels[i] == j]
        if not idx:
            continue
        gs = [rs[i] for i in idx]
        groups.append({"size": len(idx), "terms": top_terms([g["content"] for g in gs], texts),
                       "source_types": dict(collections.Counter(g["source_type"] for g in gs)),
                       "clients": dict(collections.Counter(g["metadata"].get("client", "(none)") for g in gs)),
                       "median_len": statistics.median(len(g["content"]) for g in gs),
                       "trivial_share": round(sum(len(g["content"].split()) <= 3 for g in gs) / len(gs), 2)})
    d["topic_groups"] = sorted(groups, key=lambda g: -g["size"])
    (PRIVATE / "details.json").write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(d, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
