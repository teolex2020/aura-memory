"""E36: what in the owner's real conversations is worth remembering. See PROTOCOL.md.

Everything under data/ is private and gitignored.
    python run.py extract   -> data/messages.jsonl (snapshot of the user's typed messages)
    python run.py prepare   -> data/batches/batch_<k>.jsonl (message + 3 out-of-context candidates)
    python run.py analyze   -> results.json (aggregates only)
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PROJECTS = Path.home() / ".claude" / "projects"
CUT = 2000
CANDIDATE_CUT = 1000
BATCHES = 4


def typed(d: dict) -> str | None:
    if (d.get("type") != "user" or d.get("isSidechain") or d.get("isMeta")
            or d.get("isCompactSummary") or "toolUseResult" in d):
        return None
    c = d.get("message", {}).get("content")
    if isinstance(c, list):
        if any(b.get("type") == "tool_result" for b in c):
            return None
        c = "\n".join(b.get("text", "") for b in c if b.get("type") == "text")
    c = re.sub(r"<system-reminder>.*?</system-reminder>", "", c or "", flags=re.S)
    if re.match(r"\s*<(command-|local-command|task-notification|bash-|user-memory)", c):
        return None
    c = c.strip()
    if not c or c.startswith("[Request interrupted"):
        return None
    return c


def project_name(directory: str) -> str:
    return re.sub(r"^Users-[^-]+-", "", directory.split("--")[-1] if "-----" in directory
                  else re.sub(r"^[A-Za-z]--", "", directory))


def extract() -> None:
    DATA.mkdir(exist_ok=True)
    cutoff = dt.datetime.now(dt.timezone.utc).isoformat()
    out = []
    for f in sorted(PROJECTS.glob("*/*.jsonl")):
        epoch = 0
        for line in f.read_text(encoding="utf-8", errors="replace").split("\n"):
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("isCompactSummary"):
                epoch += 1
            text = typed(d)
            ts = d.get("timestamp") or ""
            if text and ts and ts <= cutoff:
                out.append({"id": f"m{len(out):03d}", "session": f.stem, "project": project_name(f.parent.name),
                            "epoch": epoch, "ts": ts, "text": text[:CUT], "chars": len(text)})
    (DATA / "messages.jsonl").write_text("".join(json.dumps(m, ensure_ascii=False) + "\n" for m in out),
                                         encoding="utf-8")
    print(json.dumps({"messages": len(out), "cutoff": cutoff}))


def embed(texts: list[str]) -> list[list[float]]:
    body = json.dumps({"model": "bge-m3", "input": texts, "truncate": True}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())["embeddings"]


def cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def out_of_context(earlier: dict, m: dict) -> bool:
    if earlier["ts"] >= m["ts"]:
        return False
    return earlier["session"] != m["session"] or earlier["epoch"] < m["epoch"]


def messages() -> list[dict]:
    return [json.loads(l) for l in (DATA / "messages.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]


def prepare() -> None:
    ms = messages()
    vecs = []
    for i in range(0, len(ms), 16):
        vecs += embed([m["text"] for m in ms[i:i + 16]])
    rows = []
    for i, m in enumerate(ms):
        scored = sorted(((cos(vecs[i], vecs[j]), e) for j, e in enumerate(ms) if out_of_context(e, m)),
                        key=lambda x: -x[0])[:3]
        rows.append({"id": m["id"], "project": m["project"], "date": m["ts"][:10], "text": m["text"],
                     "earlier": [{"id": e["id"], "project": e["project"], "date": e["ts"][:10],
                                  "similarity": round(s, 3), "text": e["text"][:CANDIDATE_CUT]} for s, e in scored]})
    (DATA / "batches").mkdir(exist_ok=True)
    (DATA / "labels").mkdir(exist_ok=True)
    size = math.ceil(len(rows) / BATCHES)
    for k in range(BATCHES):
        part = rows[k * size:(k + 1) * size]
        (DATA / "batches" / f"batch_{k}.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in part), encoding="utf-8")
    print(json.dumps({"messages": len(rows), "with_candidates": sum(bool(r["earlier"]) for r in rows),
                      "batches": BATCHES}))


def analyze() -> None:
    ms = {m["id"]: m for m in messages()}
    labels = {}
    for f in sorted((DATA / "labels").glob("batch_*.jsonl")):
        for l in f.read_text(encoding="utf-8").split("\n"):
            if l.strip():
                r = json.loads(l)
                labels[r["id"]] = r
    missing = sorted(set(ms) - set(labels))
    rows = [labels[i] | {"project": ms[i]["project"]} for i in ms if i in labels]
    durable = [r for r in rows if r["durable"]]
    restates = [r for r in durable if r["restates"]]
    by_project = {p: {"messages": sum(r["project"] == p for r in rows),
                      "durable": sum(r["project"] == p for r in durable),
                      "restates": sum(r["project"] == p for r in restates)}
                  for p in sorted({r["project"] for r in rows})}
    d_share = round(100 * len(durable) / len(rows), 1)
    r_share = round(100 * len(restates) / len(durable), 1) if durable else 0.0
    result = {
        "messages": len(rows), "missing_labels": missing,
        "D_percent": d_share, "durable": len(durable),
        "kinds": dict(collections.Counter(r["kind"] for r in durable)),
        "restates": len(restates), "R_percent_of_durable": r_share,
        "restated_kinds": dict(collections.Counter(r["kind"] for r in restates)),
        "K1_pass": len(restates) >= 10 or r_share >= 15,
        "noise_rule_applies": d_share < 25,
    }
    # Project names stay private (data/); the committed file has aggregates only.
    (HERE / "results.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    (DATA / "by_project.json").write_text(json.dumps(by_project, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result | {"by_project": by_project}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    {"extract": extract, "prepare": prepare, "analyze": analyze}[sys.argv[1]]()
