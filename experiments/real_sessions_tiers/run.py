"""E58: levels 1 and 2 on the owner's real sessions. Local only (Ollama judge + bge-m3). See PROTOCOL.md.

Run with target/ci-venv (aura built). Outputs go to private/ (gitignored) except results.json (aggregates).
    python run.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import statistics
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from aura import Aura, Level

HERE = Path(__file__).resolve().parent
PRIVATE = HERE / "private"
PRIVATE.mkdir(exist_ok=True)
JOURNAL = Path(os.path.expandvars(r"%APPDATA%\Aura\journal"))
JUDGE = "qwen3:4b-instruct"
TAUS = (0.52, 0.55, 0.57)

_spec = importlib.util.spec_from_file_location("capture", HERE.parents[1] / "python" / "aura" / "capture.py")
capture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(capture)

_emb_cache: dict[str, list[float]] = {}


def embed(text: str) -> list[float]:
    if text not in _emb_cache:
        body = json.dumps({"model": "bge-m3", "input": [text], "truncate": True}).encode()
        req = urllib.request.Request("http://127.0.0.1:11434/api/embed", data=body, headers={"Content-Type": "application/json"})
        _emb_cache[text] = json.loads(urllib.request.urlopen(req, timeout=300).read())["embeddings"][0]
    return _emb_cache[text]


def ask(prompt: str) -> bool:
    body = json.dumps({"model": JUDGE, "prompt": prompt, "stream": False,
                       "options": {"temperature": 0, "num_predict": 4}}).encode()
    req = urllib.request.Request("http://127.0.0.1:11434/api/generate", data=body, headers={"Content-Type": "application/json"})
    out = json.loads(urllib.request.urlopen(req, timeout=600).read())["response"].strip().lower()
    return out.startswith("yes")


def prompts() -> list[dict]:
    out = []
    for f in sorted(JOURNAL.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").split("\n"):
            try:
                e = json.loads(line)
            except Exception:
                continue
            ev = e.get("event") or {}
            if e.get("kind") != "hook" or ev.get("hook_event_name") != "UserPromptSubmit":
                continue
            own, _ = capture.split_prompt(str(ev.get("prompt") or ""))
            if own:
                out.append({"text": own[:4000], "session": ev.get("session_id"), "client": e.get("client"),
                            "at": float(ev.get("received_at") or 0)})
    out.sort(key=lambda r: r["at"])
    return out


J1 = """Current conversation (most recent last):
{context}

New message from the user:
{msg}

Does answering this new message require information from EARLIER, SEPARATE conversations (past decisions, facts about the user's projects, things discussed days ago) that is not present in the current conversation above or in the message itself? Answer only yes or no."""
J2 = """Message from the user:
{msg}

Memories from the user's earlier conversations:
{mem}

Would any of these memories help respond to the message? Answer only yes or no."""
J3 = """Message a user wrote to an AI assistant:
{msg}

Is this a lasting fact, preference, decision or plan worth remembering beyond this conversation (as opposed to a one-off command or a question about the current task)? Answer only yes or no."""
J4 = """Message from the user:
{msg}

Profile built from the user's earlier conversations:
{profile}

Does this profile contain the earlier information this message needs? Answer only yes or no."""


def auc(pos, neg):
    if not pos or not neg:
        return None
    return round(sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg)), 3)


def main() -> None:
    ps = prompts()
    rows = []
    t_recall = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        brain = Aura(str(Path(d) / "aura"))
        brain.set_embedding_fn(embed)
        session_of: dict[str, str] = {}
        for i, p in enumerate(ps):
            same = [q["text"] for q in ps[:i] if q["session"] == p["session"]][-3:]
            t0 = time.perf_counter()
            hits = brain.recall_structured(p["text"], top_k=15) if i else []
            t_recall.append(1000 * (time.perf_counter() - t0))
            other = [h for h in hits if session_of.get(h["content"]) != p["session"]][:3]
            row = {"i": i, "session": p["session"], "len": len(p["text"]),
                   "top1": float(other[0]["score"]) if other else None}
            row["needs_past"] = ask(J1.format(context="\n".join(f"- {s[:500]}" for s in same) or "(start of conversation)",
                                              msg=p["text"][:1500]))
            row["useful"] = ask(J2.format(msg=p["text"][:1500], mem="\n".join(f"- {h['content'][:400]}" for h in other))) if other else None
            row["durable"] = ask(J3.format(msg=p["text"][:1500]))
            rows.append(row)
            brain.store(p["text"], level=Level.Domain, channel=f"user-{p['client'] or 'unknown'}", deduplicate=False)
            session_of[p["text"]] = p["session"]
            if i % 25 == 24:
                print(json.dumps({"done": i + 1, "of": len(ps)}), flush=True)
        brain.close()

    # level 1: profile at each session start = last 15 durable messages from earlier sessions
    first_at = {}
    for i, p in enumerate(ps):
        first_at.setdefault(p["session"], i)
    profiles, prof_chars = {}, []
    for s, i0 in first_at.items():
        earlier = [ps[j]["text"][:300] for j in range(i0) if rows[j]["durable"] and ps[j]["session"] != s][-15:]
        profiles[s] = "\n".join(f"- {t}" for t in earlier)
        prof_chars.append(len(profiles[s]))
    for r, p in zip(rows, ps):
        r["covered"] = ask(J4.format(msg=p["text"][:1500], profile=profiles[p["session"]] or "(empty)")) \
            if r["needs_past"] and profiles[p["session"]] else (False if r["needs_past"] else None)

    (PRIVATE / "rows.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    need = [r for r in rows if r["needs_past"]]
    scored = [r for r in rows if r["top1"] is not None]
    res = {"prompts": len(rows), "sessions": len(first_at),
           "p_real_needs_past": round(100 * len(need) / len(rows), 1),
           "durable_share": round(100 * sum(r["durable"] for r in rows) / len(rows), 1),
           "auc_top1_vs_needs_past": auc([r["top1"] for r in scored if r["needs_past"]], [r["top1"] for r in scored if not r["needs_past"]]),
           "auc_top1_vs_useful": auc([r["top1"] for r in scored if r["useful"]], [r["top1"] for r in scored if r["useful"] is False]),
           "useful_share_of_all_recalls": round(100 * sum(bool(r["useful"]) for r in scored) / max(1, len(scored)), 1),
           "recall_ms": {"median": round(statistics.median(t_recall), 2), "max": round(max(t_recall), 2)},
           "profile_chars": {"median": statistics.median(prof_chars), "max": max(prof_chars)},
           "level1_coverage_of_needs": round(100 * sum(bool(r["covered"]) for r in need) / max(1, len(need)), 1)}
    res["level2"] = {}
    for tau in TAUS:
        inj = [r for r in scored if r["top1"] >= tau]
        res["level2"][str(tau)] = {
            "injection_rate": round(100 * len(inj) / len(rows), 1),
            "useful_share_of_injections": round(100 * sum(bool(r["useful"]) for r in inj) / max(1, len(inj)), 1),
            "needs_past_caught": round(100 * sum(1 for r in need if r["top1"] is not None and r["top1"] >= tau) / max(1, len(need)), 1)}
    helped = [r for r in need if r["covered"] or (r["useful"] and r["top1"] is not None and r["top1"] >= 0.55)]
    res["combined_helped_of_needs"] = round(100 * len(helped) / max(1, len(need)), 1)
    l2 = res["level2"]["0.55"]
    res["gates"] = {"R1": (res["auc_top1_vs_needs_past"] or 0) >= 0.70,
                    "R2": l2["useful_share_of_injections"] >= 50,
                    "R3": res["level1_coverage_of_needs"] >= 30}
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
