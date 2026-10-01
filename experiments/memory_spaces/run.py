"""E32: memory spaces from provenance — global (G), hard walls (H), soft
preference (S, beta 0.5; S1, beta 1.0). See PROTOCOL.md.

Run in the mem0 venv with the current core on PYTHONPATH:
    python run.py hash        -> data/SHA256 (before anything reads the data)
    python run.py run LEX|EMB -> results/<emb>.jsonl
    python run.py analyze     -> results/summary.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import statistics
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "personas.jsonl"
OUT = HERE / "results"
POOL = 40
TOP = 5
BETAS = {"S": 0.5, "S1": 1.0}
IDENTITY_NS = "identity"

_spec = importlib.util.spec_from_file_location("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
e19 = importlib.util.module_from_spec(_spec)
sys.modules["e19"] = e19
_spec.loader.exec_module(e19)
from aura import Aura, Level  # noqa: E402


def personas() -> list[dict]:
    return [json.loads(l) for l in DATA.read_text(encoding="utf-8").splitlines() if l.strip()]


def hash_data() -> None:
    digest = hashlib.sha256(DATA.read_bytes()).hexdigest()
    (HERE / "data" / "SHA256").write_text(f"{digest}  personas.jsonl\n", encoding="utf-8")
    print(digest)


def build(persona: dict, directory: str, emb: str, walled: bool) -> tuple[Aura, dict]:
    """Store a persona's memories; return the brain and content -> dataset id."""
    brain = Aura(directory)
    if emb == "EMB":
        brain.set_embedding_fn(e19.embed)
    ids = {}
    for m in persona["memories"]:
        brain.store(m["text"], level=Level.Domain, source_type="recorded", deduplicate=False,
                    metadata={"space": m["space"]}, namespace=m["space"] if walled else None)
        ids[m["text"]] = m["id"]
    for f in persona["identity"]:
        brain.store(f["text"], level=Level.Identity, source_type="recorded", deduplicate=False,
                    metadata={"space": ""}, namespace=IDENTITY_NS if walled else None)
        ids[f["text"]] = f["id"]
    return brain, ids


def ranked_global(brain: Aura, question: str, k: int) -> list[dict]:
    return brain.recall_structured(question, top_k=k)


def soft(brain: Aura, question: str, current: str, beta: float) -> list[dict]:
    """Global pool re-ranked: the current space and identity facts boosted
    alike, so identity is never down-ranked relative to the space."""
    hits = brain.recall_structured(question, top_k=POOL)
    scored = []
    for h in hits:
        rec = brain.get(h["id"])
        space = (rec.metadata or {}).get("space", "") if rec is not None else ""
        boost = 1 + beta if space in (current, "") else 1.0
        scored.append((h["score"] * boost, h))
    scored.sort(key=lambda x: -x[0])
    return [h for _, h in scored[:TOP]]


def run(emb: str) -> None:
    OUT.mkdir(exist_ok=True)
    rows = []
    for persona in personas():
        space_of = {m["id"]: m["space"] for m in persona["memories"]}
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d1, \
                tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d2:
            flat, ids = build(persona, d1, emb, walled=False)
            walled, _ = build(persona, d2, emb, walled=True)
            try:
                for q in persona["questions"]:
                    arms = {
                        "G": ranked_global(flat, q["question"], TOP),
                        "H": walled.recall_structured(q["question"], top_k=TOP,
                                                      namespace=[q["space"], IDENTITY_NS]),
                        **{name: soft(flat, q["question"], q["space"], beta) for name, beta in BETAS.items()},
                    }
                    row = {"qid": q["id"], "lang": persona["lang"], "type": q["type"]}
                    for arm, hits in arms.items():
                        got = [ids.get(h["content"]) for h in hits[:TOP]]
                        other = [g for g in got if g in space_of and space_of[g] != q["space"]]
                        row[arm] = {
                            "hit": any(g in q["gold"] for g in got),
                            "intrusion": len(other) / max(len(got), 1),
                            "top": got,
                        }
                    rows.append(row)
            finally:
                flat.close()
                walled.close()
        print(persona["id"], {a: sum(r[a]["hit"] for r in rows if r["qid"].startswith(persona["id"]))
                              for a in ("G", "H", "S", "S1")}, flush=True)
    (OUT / f"{emb}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                                     encoding="utf-8")


def analyze() -> None:
    summary = {}
    for path in sorted(OUT.glob("*.jsonl")):
        rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
        arms = ("G", "H", "S", "S1")
        pct = lambda xs: round(100 * statistics.mean(xs), 1) if xs else None
        s = {}
        for t in ("in_space", "cross_space", "identity"):
            sel = [r for r in rows if r["type"] == t]
            s[t] = {a: pct([r[a]["hit"] for r in sel]) for a in arms}
        s["intrusion_in_space"] = {a: pct([r[a]["intrusion"] for r in rows if r["type"] == "in_space"]) for a in arms}
        s["by_lang"] = {lang: {a: pct([r[a]["hit"] for r in rows if r["lang"] == lang]) for a in arms}
                        for lang in ("uk", "en")}
        s["all"] = {a: pct([r[a]["hit"] for r in rows]) for a in arms}
        for arm in ("S", "S1", "H"):
            s[f"gates_{arm}"] = {
                "in_space>=G+5": s["in_space"][arm] >= s["in_space"]["G"] + 5,
                "cross_space>=G-3": s["cross_space"][arm] >= s["cross_space"]["G"] - 3,
                "identity>=G-2": s["identity"][arm] >= s["identity"]["G"] - 2,
            }
        summary[path.stem] = s
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "hash":
        hash_data()
    elif cmd == "run":
        run(sys.argv[2])
    elif cmd == "analyze":
        analyze()
