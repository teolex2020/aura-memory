"""E63: confirm "sleep" with outdated marks on fresh data. See PROTOCOL.md. Test only.

Run with E:/remy/app/.venv (numpy, pyarrow; aura is stubbed). GOOGLE_API_KEY in the repo .env (never printed).
Embeddings: bge-m3 in Ollama; E19's cache is read, new vectors go to this experiment's own cache.
    python run.py fc        -> rows_fc.jsonl, cache/links_fc.json
    python run.py lme       -> rows_lme.jsonl, cache/links_lme.json
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import random
import sqlite3
import sys
from array import array
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
(HERE / "cache").mkdir(exist_ok=True)
NEIGHBOURS, BATCH, TOP_K, CAP, MIN_COS, FRESH = 8, 10, 10, 300, 0.6, 40


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


e62 = _load("e62", EXP / "idle_consolidation" / "run.py")  # stubs aura; LINKS, parse, unit, _own_cache
e62.HERE = HERE  # its _own_cache writes under e62.HERE / "cache"
unit, parse = e62.unit, e62.parse


def newest(link: dict, s: int) -> int:
    seen = {s}
    while s in link:
        nxt = max(link[s])
        if nxt in seen:
            break
        seen.add(nxt)
        s = nxt
    return s

# ------------------------------------------------------------------ FactConsolidation 262k (E62's method)


def fc() -> None:
    e52 = _load("e52", EXP / "detective_chain" / "run.py")
    e46 = e52.e46
    e62._own_cache(e52, "CACHE", "gemini_links_fc.jsonl", 1.0)
    e62._own_cache(e46, "CACHE", "gemini_read_fc.jsonl", 0.2)
    e52.SYSTEM = "You maintain a knowledge pool while it is idle."
    tasks = [t for t in e46.tasks() if t["size"] == "262k"]
    raw = {t["name"]: e46.vecs([x for _, x in t["facts"]]) for t in tasks}
    mats = {k: unit(v) for k, v in raw.items()}
    pools = {}
    for t in tasks:
        pools.setdefault(hashlib.sha1("\n".join(x for _, x in t["facts"]).encode()).hexdigest(), t)
    links, stats = {}, {"pools": len(pools), "facts": 0, "seeds": 0, "calls": 0, "pairs": []}
    for h, t in pools.items():
        mat, facts = mats[t["name"]], t["facts"]
        blocks = []
        for i, (s, text) in enumerate(facts):
            sims = mat @ mat[i]
            order = [j for j in np.argpartition(-sims, NEIGHBOURS + 1)[:NEIGHBOURS + 1] if j != i]
            order = sorted(order, key=lambda j: -sims[j])[:NEIGHBOURS]
            newer = [facts[j] for j in order if facts[j][0] > s]
            if newer:
                blocks.append((s, text, newer))
        batches = [blocks[k:k + BATCH] for k in range(0, len(blocks), BATCH)]

        def one(batch):
            text = "\n\n".join(f"SEED {seed}\nNewer facts:\n" + "\n".join(n for _, n in newer) for _, seed, newer in batch)
            got = parse(e52.gemini(e62.LINKS.format(blocks=text))).get("updates") or []
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
        by = dict(facts)
        stats["facts"] += len(facts)
        stats["seeds"] += len(blocks)
        stats["calls"] += len(batches)
        stats["pairs"] += [[by[a], by[b]] for a, b in pairs]
        print(json.dumps({"pool": t["name"], "facts": len(facts), "seeds": len(blocks), "links": len(pairs),
                          "usd": round(e52.spent(), 3)}), flush=True)
    (HERE / "cache" / "links_fc.json").write_text(json.dumps(stats), encoding="utf-8")

    jobs = []
    for t in tasks:
        h = hashlib.sha1("\n".join(x for _, x in t["facts"]).encode()).hexdigest()
        by = dict(t["facts"])
        for qi, q in enumerate(t["questions"]):
            shown = [t["facts"][i][0] for i in e46.retrieve(t, raw[t["name"]], q, "R0")]
            extra = []
            for s in shown:
                n = newest(links[h], s)
                if n != s and n not in shown and n not in extra:
                    extra.append(n)
            marked = [by[s] + (f" [outdated: updated by fact #{newest(links[h], s)}]" if newest(links[h], s) != s else "")
                      for s in shown] + [by[n] for n in extra]
            jobs.append((t, qi, marked))

    def read(job) -> dict:
        t, qi, lines = job
        golds = t["answers"][qi] if isinstance(t["answers"][qi], list) else [t["answers"][qi]]
        pred = e46.read("\n".join(lines), t["questions"][qi])
        return {"name": t["name"], "hop": t["hop"], "q": qi, "K2": any(e46.SUB_EM(pred, str(g)) for g in golds)}

    with ThreadPoolExecutor(8) as ex:
        rows = list(ex.map(read, jobs))
    (HERE / "rows_fc.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"fc_read": len(rows), "usd_links": round(e52.spent(), 3), "usd_read": round(e46.spent(), 3)}))

# ------------------------------------------------------------------ LongMemEval, fresh questions

LINKS_LME = """Things a user said in past conversations, each with a number (a larger number is later) and its time.
For each SEED below, look at the later statements listed under it. A later statement UPDATES the seed when it gives a new value for the same thing about the user (a number, a place, a plan, a status, a possession, a preference, a habit).

{blocks}

Reply with one JSON object only: {{"updates": [[<seed number>, <later number>], ...]}} (an empty list if none)."""

_db = sqlite3.connect(HERE / "cache" / "embeddings.sqlite")
_db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")


def lme() -> None:
    e59 = _load("e59", EXP / "memory_vs_context" / "run.py")
    e59._lme_modules()
    e35, e20 = e59.e35, e59.e20
    e19 = e35.e19
    e62._own_cache(e35, "CACHE_PATH", "gemini_lme.jsonl", 1.7)

    def embed(texts: list[str]) -> np.ndarray:
        """Main thread only. E19's cache is read; misses go to Ollama and this experiment's cache."""
        out, miss = {}, []
        for t in texts:
            k = e19._key(t)
            row = e19._db.execute("SELECT v FROM emb WHERE h=?", (k,)).fetchone() or \
                _db.execute("SELECT v FROM emb WHERE h=?", (k,)).fetchone()
            if row:
                out[t] = array("f", row[0]).tolist()
            else:
                miss.append(t)
        for i in range(0, len(miss), 32):
            chunk = miss[i:i + 32]
            for t, v in zip(chunk, e19._ollama_safe(chunk)):
                out[t] = v
                _db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (e19._key(t), array("f", v).tobytes()))
            _db.commit()
        return unit([out[t] for t in texts])

    sample = {q["question_id"] for q in e35.questions()}
    pool = [q for q in e19.load() if not q["question_id"].endswith("_abs") and q["question_id"] not in sample]
    rng = random.Random(63)
    qs = []
    for qtype in ("knowledge-update", "temporal-reasoning"):
        of_type = [q for q in pool if q["question_type"] == qtype]
        qs += rng.sample(of_type, FRESH)

    prepared = []
    for n, q in enumerate(qs, 1):
        first = {}
        for r in e35.records(q, "U"):
            first.setdefault(r["text"], r)
        recs = sorted(first.values(), key=lambda r: r["date"])
        for k, r in enumerate(recs, 1):
            r["n"] = k
        mat = embed([r["text"] for r in recs])
        qv = embed([q["question"]])[0]
        blocks = []
        for i, r in enumerate(recs):
            sims = mat @ mat[i]
            order = [j for j in np.argsort(-sims)[:NEIGHBOURS + 1] if j != i][:NEIGHBOURS]
            later = [recs[j] for j in order if recs[j]["n"] > r["n"] and sims[j] >= MIN_COS]
            if later:
                blocks.append((r, later))
        prepared.append({"q": q, "recs": recs, "top": [recs[i] for i in np.argsort(-(mat @ qv))[:TOP_K]], "blocks": blocks})
        if n % 10 == 0:
            print(json.dumps({"prepared": n}), flush=True)

    def line(r) -> str:
        return f"#{r['n']} [{r['date']}] {r['text'][:CAP]}"

    def link_one(p) -> dict:
        batches = [p["blocks"][k:k + BATCH] for k in range(0, len(p["blocks"]), BATCH)]
        link = {}
        for batch in batches:
            text = "\n\n".join(f"SEED {line(r)}\nLater statements:\n" + "\n".join(line(x) for x in later) for r, later in batch)
            got = parse(e35.gemini(None, LINKS_LME.format(blocks=text), 512)["text"]).get("updates") or []
            allowed = {r["n"]: {x["n"] for x in later} for r, later in batch}
            for pr in got:
                try:
                    a, b = int(pr[0]), int(pr[1])
                except (TypeError, ValueError, IndexError):
                    continue
                if a in allowed and b in allowed[a]:
                    link.setdefault(a, []).append(b)
        return {"link": link, "calls": len(batches), "seeds": len(p["blocks"])}

    with ThreadPoolExecutor(6) as ex:
        linked = list(ex.map(link_one, prepared))
    print(json.dumps({"linked": len(linked), "usd": round(e35.spent(), 3)}), flush=True)
    (HERE / "cache" / "links_lme.json").write_text(json.dumps(
        {p["q"]["question_id"]: {"records": len(p["recs"]), **{k: v for k, v in L.items() if k != "link"},
                                 "links": [[a, b] for a, bs in L["link"].items() for b in bs]}
         for p, L in zip(prepared, linked)}), encoding="utf-8")

    def block(r, mark: str = "") -> str:
        return f"[Session time: {r['date']}]{mark}\nUser: {r['text']}"

    def prompt(q, blocks) -> str:
        return (f"Current date: {q['question_date']}\n\nRetrieved memories:\n\n"
                + "\n\n---\n\n".join(blocks) + f"\n\nQuestion: {q['question']}")

    def answer(job) -> dict:
        p, L = job
        q, link = p["q"], L["link"]
        by_n = {r["n"]: r for r in p["recs"]}
        shown = [r["n"] for r in p["top"]]
        extra, k2 = [], []
        for r in p["top"]:
            nw = newest(link, r["n"])
            k2.append(block(r, f" [outdated: updated by what the user said on {by_n[nw]['date']}]" if nw != r["n"] else ""))
            if nw != r["n"] and nw not in shown and nw not in extra:
                extra.append(nw)
        k2 += [block(by_n[n]) for n in extra]
        row = {"qid": q["question_id"], "type": q["question_type"], "question": q["question"],
               "marked": sum("[outdated:" in b for b in k2), "added": len(extra)}
        for arm, blocks in (("Cp", [block(r) for r in p["top"]]), ("K2", k2)):
            ans = e35.gemini(e35.NEUTRAL, prompt(q, blocks), 1024)["text"]
            v = e35.gemini(None, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], ans), 64)["text"]
            row[arm] = v.strip().lower().startswith("yes")
            row[f"{arm}_answer"] = ans[:400]
        row["gold"] = str(q["answer"])[:200]
        return row

    with ThreadPoolExecutor(6) as ex:
        rows = list(ex.map(answer, zip(prepared, linked)))
    (HERE / "rows_lme.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"lme": len(rows), "usd": round(e35.spent(), 3)}))

# ------------------------------------------------------------------ analysis


def load(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").split("\n") if x.strip()]


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def same_slot(a: str, b: str) -> bool:
    """Measurement only (synthetic FC facts): the two facts share their wording up to the last value."""
    k = 0
    while k < min(len(a), len(b)) and a[k] == b[k]:
        k += 1
    body = lambda s: s.split(". ", 1)[-1]
    k2 = 0
    a2, b2 = body(a), body(b)
    while k2 < min(len(a2), len(b2)) and a2[k2] == b2[k2]:
        k2 += 1
    return k2 >= 0.6 * min(len(a2), len(b2))


def analyze() -> None:
    key = lambda r: (r["name"], r["q"])
    r0 = {key(r): r["correct"] for r in load(EXP / "stale_facts" / "rows.jsonl") if r["arm"] == "R0"}
    cn = {key(r): r["correct"] for r in load(EXP / "detective_chain" / "rows_b.jsonl")}
    fcr = load(HERE / "rows_fc.jsonl")
    fc_res = {hop: {"R0": pct(r0[key(r)] for r in fcr if r["hop"] == hop), "K2": pct(r["K2"] for r in fcr if r["hop"] == hop),
                    "CN": pct(cn[key(r)] for r in fcr if r["hop"] == hop)} for hop in ("sh", "mh")}
    st = json.loads((HERE / "cache" / "links_fc.json").read_text(encoding="utf-8"))
    idle_fc = e62.usd("gemini_links_fc.jsonl")
    fc_res["idle"] = {k: st[k] for k in ("pools", "facts", "seeds", "calls")} | {"links": len(st["pairs"]), **idle_fc,
                      "usd_per_1000_facts": round(1000 * idle_fc["usd"] / st["facts"], 3),
                      "approx_precision": pct(same_slot(a, b) for a, b in st["pairs"])}

    lrows = load(HERE / "rows_lme.jsonl")
    ll = json.loads((HERE / "cache" / "links_lme.json").read_text(encoding="utf-8"))
    lme_res = {}
    for t in ("knowledge-update", "temporal-reasoning"):
        sub = [r for r in lrows if r["type"] == t]
        lme_res[t] = {"n": len(sub), "Cp": pct(r["Cp"] for r in sub), "K2": pct(r["K2"] for r in sub),
                      "fixed": sum(r["K2"] and not r["Cp"] for r in sub), "broke": sum(r["Cp"] and not r["K2"] for r in sub),
                      "with_mark_in_top10": pct(r["marked"] > 0 for r in sub)}
    recs = sum(v["records"] for v in ll.values())
    idle_lme = e62.usd("gemini_lme.jsonl")
    lme_res["idle"] = {"records": recs, "seeds": sum(v["seeds"] for v in ll.values()), "calls": sum(v["calls"] for v in ll.values()),
                       "links": sum(len(v["links"]) for v in ll.values()), "all_calls_usd": idle_lme["usd"]}
    res = {"factconsolidation_262k": fc_res, "longmemeval_fresh": lme_res}
    res["hypotheses"] = {"Y1_fc262k_sh": fc_res["sh"]["K2"] >= fc_res["sh"]["R0"] + 10,
                         "Y2_lme_ku": lme_res["knowledge-update"]["K2"] >= lme_res["knowledge-update"]["Cp"] + 5,
                         "Y3_lme_temporal_no_harm": lme_res["temporal-reasoning"]["K2"] >= lme_res["temporal-reasoning"]["Cp"] - 2}
    res["usd_total"] = round(idle_fc["usd"] + e62.usd("gemini_read_fc.jsonl")["usd"] + idle_lme["usd"], 3)
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))
    print("--- disagreements")
    for r in lrows:
        if r["Cp"] != r["K2"]:
            print(json.dumps({k: r[k] for k in ("type", "question", "gold", "Cp", "K2", "marked", "Cp_answer", "K2_answer")}, ensure_ascii=False))


if __name__ == "__main__":
    {"fc": fc, "lme": lme, "analyze": analyze}[sys.argv[1]]()
