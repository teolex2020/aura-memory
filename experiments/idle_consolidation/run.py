"""E62: analysis while idle ("sleep") instead of at answer time. See PROTOCOL.md. Test only.

Run with E:/remy/app/.venv (numpy, pyarrow; aura is stubbed, nothing here needs it).
GOOGLE_API_KEY in the repo .env (never printed). Embeddings: bge-m3 in Ollama (E19 / E46 caches).
    python run.py fc        -> cache/links.json, rows_fc.jsonl
    python run.py lme       -> cache/notes.json, rows_lme.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
(HERE / "cache").mkdir(exist_ok=True)
SIZES = ("6k", "32k", "64k")
NEIGHBOURS, BATCH, TOP_K, NOTE_CAP = 8, 10, 10, 600

try:
    import aura  # noqa: F401
except ImportError:
    sys.modules["aura"] = types.SimpleNamespace(Aura=None, Level=None)


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


def parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        o = json.loads(m.group(0)) if m else {}
    except Exception:
        o = {}
    return o if isinstance(o, dict) else {}


def unit(mat) -> np.ndarray:
    mat = np.asarray(mat, dtype=np.float32)
    return mat / np.linalg.norm(mat, axis=-1, keepdims=True).clip(1e-9)

# ------------------------------------------------------------------ FactConsolidation: version links

LINKS = """Facts from a knowledge pool, each with a serial number (a larger number is newer).
For each SEED below, look at the newer facts listed under it. A newer fact UPDATES the seed when it states the same relation about the same subject with a different value.

{blocks}

Reply with one JSON object only: {{"updates": [[<seed serial>, <newer serial>], ...]}} (an empty list if none)."""


def fc() -> None:
    e52 = _load("e52", EXP / "detective_chain" / "run.py")
    e46 = e52.e46
    _own_cache(e52, "CACHE", "gemini_links.jsonl", 1.2)
    _own_cache(e46, "CACHE", "gemini_fc_read.jsonl", 0.3)
    e52.SYSTEM = "You maintain a knowledge pool while it is idle."
    tasks = [t for t in e46.tasks() if t["size"] in SIZES]
    raw = {t["name"]: e46.vecs([x for _, x in t["facts"]]) for t in tasks}  # sqlite: main thread
    mats = {name: unit(m) for name, m in raw.items()}

    pools, links = {}, {}
    for t in tasks:
        pools.setdefault(hashlib.sha1("\n".join(x for _, x in t["facts"]).encode()).hexdigest(), t)
    stats = {"pools": len(pools), "seeds_checked": 0, "calls": 0}
    for h, t in pools.items():
        mat, facts = mats[t["name"]], t["facts"]
        blocks = []
        for i, (s, text) in enumerate(facts):
            order = [j for j in np.argsort(-(mat @ mat[i]))[:NEIGHBOURS + 1] if j != i][:NEIGHBOURS]
            newer = [facts[j] for j in order if facts[j][0] > s]
            if newer:
                blocks.append((s, text, newer))
        batches = [blocks[k:k + BATCH] for k in range(0, len(blocks), BATCH)]

        def one(batch):
            text = "\n\n".join(f"SEED {seed}\nNewer facts:\n" + "\n".join(n for _, n in newer) for _, seed, newer in batch)
            got = parse(e52.gemini(LINKS.format(blocks=text))).get("updates") or []
            allowed = {s: {n for n, _ in newer} for s, _, newer in batch}
            out = []
            for p in got:
                try:
                    a, b = int(p[0]), int(p[1])
                except (TypeError, ValueError, IndexError):
                    continue
                if a in allowed and b in allowed[a]:
                    out.append((a, b))
            return out

        with ThreadPoolExecutor(8) as ex:
            pairs = [p for ps in ex.map(one, batches) for p in ps]
        link = {}
        for a, b in pairs:
            link.setdefault(a, []).append(b)
        links[h] = link
        stats["seeds_checked"] += len(blocks)
        stats["calls"] += len(batches)
        print(json.dumps({"pool": t["name"], "facts": len(facts), "seeds": len(blocks), "links": len(pairs),
                          "usd": round(e52.spent(), 3)}), flush=True)
    stats["links"] = sum(len(v) for v in links.values())
    stats["facts"] = sum(len(t["facts"]) for t in pools.values())
    (HERE / "cache" / "links.json").write_text(json.dumps({"stats": stats, "links": links}), encoding="utf-8")

    def newest(link: dict, s: int) -> int:
        seen = {s}
        while str(s) in link or s in link:
            nxt = max(link.get(s) or link.get(str(s)))
            if nxt in seen:
                break
            seen.add(nxt)
            s = nxt
        return s

    jobs = []
    for t in tasks:
        h = hashlib.sha1("\n".join(x for _, x in t["facts"]).encode()).hexdigest()
        by_serial = {s: x for s, x in t["facts"]}
        for qi, q in enumerate(t["questions"]):
            idx = e46.retrieve(t, raw[t["name"]], q, "R0")  # exactly E46's R0
            shown = [t["facts"][i][0] for i in idx]
            extra = []
            for s in shown:
                n = newest(links[h], s)
                if n != s and n not in shown and n not in extra:
                    extra.append(n)
            marked = [by_serial[s] + (f" [outdated: updated by fact #{newest(links[h], s)}]" if newest(links[h], s) != s else "")
                      for s in shown]
            jobs.append((t, qi, [by_serial[s] for s in shown + extra], len(extra), marked + [by_serial[n] for n in extra]))

    def read(job) -> dict:
        t, qi, lines, added, marked = job
        golds = t["answers"][qi] if isinstance(t["answers"][qi], list) else [t["answers"][qi]]
        pred = e46.read("\n".join(lines), t["questions"][qi])
        pred_m = e46.read("\n".join(marked), t["questions"][qi])  # K2, exploratory, added after diagnosis
        return {"name": t["name"], "hop": t["hop"], "size": t["size"], "q": qi, "added": added,
                "marked": sum("[outdated:" in x for x in marked),
                "K": any(e46.SUB_EM(pred, str(g)) for g in golds), "K2": any(e46.SUB_EM(pred_m, str(g)) for g in golds)}

    with ThreadPoolExecutor(8) as ex:
        rows = list(ex.map(read, jobs))
    (HERE / "rows_fc.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"fc_read": len(rows), "usd_links": round(e52.spent(), 3), "usd_read": round(e46.spent(), 3)}))

# ------------------------------------------------------------------ LongMemEval: notes

NOTES = """Below is everything a user said in past conversations with an assistant, in time order, each line with its session time. You are consolidating this memory while idle, so that future questions can be answered from it.

Write notes of two kinds, one per line:
- When something the user said changed later (a number, a place, a plan, a preference, a status, a possession): <thing>: <old value> (<time>) -> <new value> (<time>). Keep both values.
- When the user mentioned the same kind of thing several times (items bought, events attended, people met, places visited, time spent): <kind>: <each mention with its time>; total <n> if it can be counted.
Use only what the user said. At most 40 lines. No other text.

What the user said:
{lines}"""


def lme() -> None:
    e59 = _load("e59", EXP / "memory_vs_context" / "run.py")
    e59._lme_modules()
    e35, e20 = e59.e35, e59.e20
    e19 = e35.e19
    _own_cache(e35, "CACHE_PATH", "gemini_lme.jsonl", 1.5)
    qs = e35.questions()

    def recs_of(q):
        first = {}
        for r in e35.records(q, "U"):
            first.setdefault(r["text"], r)
        return sorted(first.values(), key=lambda r: r["date"])

    def notes_of(q) -> list[str]:
        lines = "\n".join(f"[{r['date']}] {r['text'][:NOTE_CAP]}" for r in recs_of(q))
        out = e35.gemini(None, NOTES.format(lines=lines), 4096)["text"]
        return [x.strip().lstrip("-* ").strip() for x in out.split("\n") if x.strip() and ":" in x][:40]

    with ThreadPoolExecutor(6) as ex:
        notes = dict(zip([q["question_id"] for q in qs], ex.map(notes_of, qs)))
    print(json.dumps({"notes": sum(len(v) for v in notes.values()), "usd": round(e35.spent(), 3)}), flush=True)
    (HERE / "cache" / "notes.json").write_text(json.dumps(notes, ensure_ascii=False), encoding="utf-8")

    def block(item) -> str:
        if item["kind"] == "note":
            return f"[Consolidation note made while idle]\nNote: {item['text']}"
        return f"[Session time: {item['date']}]\nUser: {item['text']}"

    def prompt(q, items) -> str:
        return (f"Current date: {q['question_date']}\n\nRetrieved memories:\n\n"
                + "\n\n---\n\n".join(block(i) for i in items) + f"\n\nQuestion: {q['question']}")

    jobs = []
    for q in qs:  # embeddings on the main thread; records from E19's cache, notes fresh (E19's cache is not written)
        recs = [dict(r, kind="user") for r in recs_of(q)]
        nts = [{"kind": "note", "text": t} for t in notes[q["question_id"]]]
        qv = unit(e19.embed(q["question"]))
        mat_r = unit([e19.embed(r["text"]) for r in recs])
        top_c = [recs[i] for i in np.argsort(-(mat_r @ qv))[:TOP_K]]
        both = recs + nts
        mat_b = np.vstack([mat_r, unit(e19._ollama_safe([n["text"] for n in nts]))]) if nts else mat_r
        top_k = [both[i] for i in np.argsort(-(mat_b @ qv))[:TOP_K]]
        jobs.append((q, top_c, top_k))

    def one(job) -> dict:
        q, top_c, top_k = job
        row = {"qid": q["question_id"], "type": q["question_type"], "notes_in_top": sum(i["kind"] == "note" for i in top_k)}
        for arm, items in (("Cp", top_c), ("K", top_k)):
            ans = e35.gemini(e35.NEUTRAL, prompt(q, items), 1024)["text"]
            v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], ans), 64)["text"]
            row[arm] = v.strip().lower().startswith("yes")
        return row

    with ThreadPoolExecutor(6) as ex:
        rows = list(ex.map(one, jobs))
    (HERE / "rows_lme.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"lme": len(rows), "usd": round(e35.spent(), 3)}))

# ------------------------------------------------------------------ analysis


def load(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").split("\n") if x.strip()]


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def usd(file: str) -> dict:
    tin = tout = 0
    path = HERE / "cache" / file
    if path.exists():
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                u = json.loads(line).get("usage", {})
                tin += u.get("promptTokenCount", 0)
                tout += u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
    return {"in_tokens": tin, "out_tokens": tout, "usd": round(tin * 0.25 / 1e6 + tout * 1.5 / 1e6, 3)}


def analyze() -> None:
    key = lambda r: (r["name"], r["q"])
    r0 = {key(r): r["correct"] for r in load(EXP / "stale_facts" / "rows.jsonl") if r["arm"] == "R0"}
    cn = {key(r): r["correct"] for r in load(EXP / "detective_chain" / "rows_b.jsonl")}
    fcr = load(HERE / "rows_fc.jsonl")
    for r in fcr:
        r["R0"], r["CN"] = r0[key(r)], cn[key(r)]
    arms = ("R0", "K", "K2", "CN")
    fc_res = {hop: {a: pct(r[a] for r in fcr if r["hop"] == hop) for a in arms} for hop in ("sh", "mh")}
    for hop in ("sh", "mh"):
        fc_res[hop]["by_size"] = {s: {a: pct(r[a] for r in fcr if r["hop"] == hop and r["size"] == s) for a in arms} for s in SIZES}
        fc_res[hop]["questions_with_marked_fact"] = pct(r["marked"] > 0 for r in fcr if r["hop"] == hop)
        fc_res[hop]["questions_with_added_version"] = pct(r["added"] > 0 for r in fcr if r["hop"] == hop)
    link_stats = json.loads((HERE / "cache" / "links.json").read_text(encoding="utf-8"))["stats"]
    idle_fc = usd("gemini_links.jsonl")
    fc_res["idle"] = {**link_stats, **idle_fc, "usd_per_1000_facts": round(1000 * idle_fc["usd"] / link_stats["facts"], 3)}

    lrows = load(HERE / "rows_lme.jsonl")
    c = {r["qid"]: r["correct"] for r in load(EXP / "capture_value" / "rows.jsonl") if r["arm"] == "U"}
    for r in lrows:
        r["C"] = c[r["qid"]]
    types_ = sorted({r["type"] for r in lrows})
    notes = json.loads((HERE / "cache" / "notes.json").read_text(encoding="utf-8"))
    lme_res = {"questions": len(lrows), "accuracy": {a: pct(r[a] for r in lrows) for a in ("C", "Cp", "K")},
               "by_type": {t: {a: pct(r[a] for r in lrows if r["type"] == t) for a in ("C", "Cp", "K")} for t in types_},
               "K_vs_Cp": {"fixed": sum(r["K"] and not r["Cp"] for r in lrows), "broke": sum(r["Cp"] and not r["K"] for r in lrows)},
               "notes_per_haystack_mean": round(sum(len(v) for v in notes.values()) / len(notes), 1),
               "questions_with_note_in_top10": pct(r["notes_in_top"] > 0 for r in lrows)}
    lme_cost = usd("gemini_lme.jsonl")
    lme_res["all_calls_cost"] = lme_cost
    focus = [r for r in lrows if r["type"] in ("knowledge-update", "multi-session", "temporal-reasoning")]
    res = {"factconsolidation": fc_res, "longmemeval": lme_res}
    res["hypotheses"] = {
        "Z1_links_fix_single_hop": fc_res["sh"]["K"] >= 90,
        "Z1_exploratory_K2_marked": fc_res["sh"]["K2"] >= 90,
        "Z2_notes_do_not_hurt": lme_res["accuracy"]["K"] >= lme_res["accuracy"]["Cp"] - 2,
        "Z3_notes_help_versions_and_counts": pct(r["K"] for r in focus) >= pct(r["Cp"] for r in focus) + 5,
        "Z3_values": {"Cp": pct(r["Cp"] for r in focus), "K": pct(r["K"] for r in focus)}}
    res["usd_total"] = round(idle_fc["usd"] + usd("gemini_fc_read.jsonl")["usd"] + lme_cost["usd"], 3)
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"fc": fc, "lme": lme, "analyze": analyze}[sys.argv[1]]()
