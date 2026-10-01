"""E34: which small embedding model for opt-in smart search. See PROTOCOL.md.

Every candidate runs through the same llama.cpp server (CPU build), one at a
time. Query/document formats follow each model's card and are fixed here.

Run in the mem0 venv with the current core on PYTHONPATH:
    python run.py d3  <MODEL>   -> results/d3_<MODEL>.json   (Belebele, 15 languages)
    python run.py d2  <MODEL>   -> results/d2_<MODEL>.json   (E32 personas through Aura)
    python run.py d1  <MODEL>   -> results/d1_<MODEL>.jsonl  (LongMemEval-120 through Aura)
    python run.py speed <MODEL> -> results/speed_<MODEL>.json
    python run.py analyze       -> results/summary.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from array import array
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
OUT.mkdir(exist_ok=True)
MODELS_DIR = Path(r"C:\aura-neural-models\embeddings")
LLAMA = Path(r"D:\Aura-clean\tools\neural_runner\llama-b9870-cpu\llama-server.exe")
PORT = 8734
MAX_CHARS = 6000  # long turns are cut, as E19 truncated for bge-m3

RETRIEVE = "Given a question, retrieve passages that answer the question"
MODELS = {
    "BGE": {"file": "bge-m3-q8_0.gguf", "query": "{t}", "doc": "{t}"},
    "QWEN": {"file": "Qwen3-Embedding-0.6B-Q8_0.gguf",
             "query": "Instruct: " + RETRIEVE + "\nQuery: {t}", "doc": "{t}"},
    "GEMMA": {"file": "embeddinggemma-300M-Q8_0.gguf",
              "query": "task: search result | query: {t}", "doc": "title: none | text: {t}"},
    "GRANITE": {"file": "granite-embedding-311M-multilingual-r2-Q8_0.gguf", "query": "{t}", "doc": "{t}"},
    "HARRIER": {"file": "harrier-oss-v1-0.6b.Q8_0.gguf",
                "query": "Instruct: " + RETRIEVE + "\nQuery: {t}", "doc": "{t}"},
}
LANGS = ["eng_Latn", "spa_Latn", "deu_Latn", "fra_Latn", "por_Latn", "ita_Latn", "pol_Latn", "ukr_Cyrl",
         "rus_Cyrl", "zho_Hans", "jpn_Jpan", "kor_Hang", "arb_Arab", "hin_Deva", "tur_Latn"]


# ------------------------------------------------------------------ server

class Server:
    def __init__(self, model: str):
        self.model = model
        self.spec = MODELS[model]
        path = MODELS_DIR / self.spec["file"]
        if not path.exists():
            raise SystemExit(f"missing {path}")
        self.proc = subprocess.Popen(
            [str(LLAMA), "-m", str(path), "--embeddings", "--port", str(PORT), "-c", "8192",
             "-b", "8192", "-ub", "8192", "--log-disable"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(240):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2) as r:
                    if json.loads(r.read()).get("status") == "ok":
                        break
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.5)
        else:
            self.close()
            raise SystemExit(f"{model}: server did not start")
        (HERE / "cache").mkdir(exist_ok=True)
        self.db = sqlite3.connect(HERE / "cache" / f"{model}.sqlite")
        self.db.execute("CREATE TABLE IF NOT EXISTS emb (h TEXT PRIMARY KEY, v BLOB)")
        self.mode = "doc"

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            self.proc.kill()

    def rss_mb(self) -> float:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              f"(Get-Process -Id {self.proc.pid}).WorkingSet64"],
                             capture_output=True, text=True).stdout.strip()
        return round(int(out or 0) / 1e6, 1)

    def _format(self, text: str, kind: str) -> str:
        return self.spec[kind].format(t=text[:MAX_CHARS])

    def embed_many(self, texts: list[str], kind: str) -> list[list[float]]:
        formatted = [self._format(t, kind) for t in texts]
        keys = [hashlib.sha1(f.encode("utf-8")).hexdigest() for f in formatted]
        out: dict[str, list[float]] = {}
        for k in set(keys):
            row = self.db.execute("SELECT v FROM emb WHERE h=?", (k,)).fetchone()
            if row:
                out[k] = array("f", row[0]).tolist()
        todo = [(k, f) for k, f in dict(zip(keys, formatted)).items() if k not in out]
        for i in range(0, len(todo), 16):
            chunk = todo[i:i + 16]
            body = json.dumps({"input": [f for _, f in chunk]}).encode()
            req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/embeddings", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.loads(r.read())["data"]
            for (k, _), item in zip(chunk, sorted(data, key=lambda d: d["index"])):
                v = item["embedding"]
                n = math.sqrt(sum(x * x for x in v)) or 1.0
                v = [x / n for x in v]
                out[k] = v
                self.db.execute("INSERT OR REPLACE INTO emb VALUES (?, ?)", (k, array("f", v).tobytes()))
            self.db.commit()
        return [out[k] for k in keys]

    def embed_fn(self, text: str) -> list[float]:
        """For Aura: document format while storing, query format while recalling."""
        return self.embed_many([text], self.mode)[0]


def cos(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))


# ------------------------------------------------------------------ D3 Belebele

def load_belebele():
    rows = {l: [json.loads(x) for x in (HERE / "data" / "belebele" / f"{l}.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
            for l in LANGS}
    eng = rows["eng_Latn"]
    # Rows are aligned across languages; a passage id comes from the English text.
    pid_of_text, pids = {}, []
    for r in eng:
        pids.append(pid_of_text.setdefault(r["flores_passage"], len(pid_of_text)))
    for l in LANGS:
        assert len(rows[l]) == len(eng) and all(a["link"] == b["link"] for a, b in zip(rows[l], eng)), l
    passages = {}
    for l in LANGS:
        texts = {}
        for r, pid in zip(rows[l], pids):
            texts.setdefault(pid, r["flores_passage"])
        passages[l] = [texts[i] for i in range(len(texts))]
    questions = {l: [r["question"] for r in rows[l]] for l in LANGS}
    return passages, questions, pids


def d3(model: str) -> None:
    passages, questions, pids = load_belebele()
    srv = Server(model)
    try:
        P = {l: srv.embed_many(passages[l], "doc") for l in LANGS}
        Q = {l: srv.embed_many(questions[l], "query") for l in LANGS}
    finally:
        srv.close()

    def score(ql, pl):
        r1, ndcg = [], []
        for qv, pid in zip(Q[ql], pids):
            sims = sorted(((cos(qv, pv), i) for i, pv in enumerate(P[pl])), reverse=True)[:10]
            ranked = [i for _, i in sims]
            r1.append(ranked[0] == pid)
            ndcg.append(1 / math.log2(ranked.index(pid) + 2) if pid in ranked else 0.0)
        return round(100 * statistics.mean(r1), 1), round(100 * statistics.mean(ndcg), 1)

    res = {"mono": {l: score(l, l) for l in LANGS},
           "en_to_x": {l: score("eng_Latn", l) for l in LANGS if l != "eng_Latn"},
           "x_to_en": {l: score(l, "eng_Latn") for l in LANGS if l != "eng_Latn"}}
    for k in ("mono", "en_to_x", "x_to_en"):
        res[k + "_macro"] = {"recall@1": round(statistics.mean(v[0] for v in res[k].values()), 1),
                             "ndcg@10": round(statistics.mean(v[1] for v in res[k].values()), 1)}
    res["cross_macro_ndcg@10"] = round((res["en_to_x_macro"]["ndcg@10"] + res["x_to_en_macro"]["ndcg@10"]) / 2, 1)
    (OUT / f"d3_{model}.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(model, "mono", res["mono_macro"], "cross", res["cross_macro_ndcg@10"])


# ------------------------------------------------------------------ D1/D2 through Aura

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def d1(model: str) -> None:
    e19 = _load("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
    from aura import Aura, Level
    out = OUT / f"d1_{model}.jsonl"
    done = {json.loads(l)["qid"] for l in out.read_text(encoding="utf-8").splitlines()} if out.exists() else set()
    srv = Server(model)
    try:
        with out.open("a", encoding="utf-8") as f:
            for n, q in enumerate(e19.select(e19.load(), "sample"), 1):
                if q["question_id"] in done:
                    continue
                ts = e19.turns(q)
                srv.embed_many([t["content"] for t in ts], "doc")  # warm the cache in batches
                with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                    brain = Aura(str(Path(d) / "aura"))
                    brain.set_embedding_fn(srv.embed_fn)
                    srv.mode = "doc"
                    for t in ts:
                        channel = "user-claude-code" if t["role"] == "user" else "agent-claude-code"
                        brain.store(t["content"], level=Level.Domain, channel=channel, deduplicate=False)
                    srv.mode = "query"
                    hits = brain.recall_structured(q["question"], top_k=e19.TOP_K)
                    brain.close()
                row = {"qid": q["question_id"], "type": q["question_type"],
                       **e19.judge([h["content"] for h in hits], ts, set(q["answer_session_ids"]))}
                f.write(json.dumps(row) + "\n")
                f.flush()
                print(model, n, row["turn_any@10"], flush=True)
    finally:
        srv.close()


def d2(model: str) -> None:
    from aura import Aura, Level
    personas = [json.loads(l) for l in (HERE.parent / "memory_spaces" / "data" / "personas.jsonl")
                .read_text(encoding="utf-8").splitlines() if l.strip()]
    srv = Server(model)
    rows = []
    try:
        for p in personas:
            texts = [m["text"] for m in p["memories"]] + [f["text"] for f in p["identity"]]
            srv.embed_many(texts, "doc")
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                brain = Aura(d)
                brain.set_embedding_fn(srv.embed_fn)
                srv.mode = "doc"
                ids = {}
                for m in p["memories"]:
                    brain.store(m["text"], level=Level.Domain, source_type="recorded", deduplicate=False)
                    ids[m["text"]] = m["id"]
                for fct in p["identity"]:
                    brain.store(fct["text"], level=Level.Identity, source_type="recorded", deduplicate=False)
                    ids[fct["text"]] = fct["id"]
                srv.mode = "query"
                for q in p["questions"]:
                    got = [ids.get(h["content"]) for h in brain.recall_structured(q["question"], top_k=5)]
                    rows.append({"qid": q["id"], "lang": p["lang"], "type": q["type"],
                                 "hit": any(g in q["gold"] for g in got)})
                brain.close()
    finally:
        srv.close()
    pct = lambda xs: round(100 * statistics.mean(xs), 1)
    res = {"all": pct([r["hit"] for r in rows]),
           **{t: pct([r["hit"] for r in rows if r["type"] == t]) for t in ("in_space", "cross_space", "identity")},
           **{l: pct([r["hit"] for r in rows if r["lang"] == l]) for l in ("uk", "en")}}
    (OUT / f"d2_{model}.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(model, res)


def speed(model: str) -> None:
    e19 = _load("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
    texts = []
    for q in e19.select(e19.load(), "sample"):
        texts += [t["content"] for t in e19.turns(q)]
        if len(texts) >= 2000:
            break
    texts = [f"{i} {t}" for i, t in enumerate(texts[:2000])]  # unique, so nothing comes from cache
    srv = Server(model)
    try:
        start = time.perf_counter()
        srv.embed_many(texts, "doc")
        docs_s = len(texts) / (time.perf_counter() - start)
        rss = srv.rss_mb()
        lat = []
        for q in ["Where does my sister live?", "Що я казав про бюджет ремонту?", "¿Cuándo es mi cita con el dentista?"] * 7:
            t0 = time.perf_counter()
            srv.embed_many([q + str(time.perf_counter())], "query")
            lat.append((time.perf_counter() - t0) * 1000)
    finally:
        srv.close()
    res = {"docs_per_s": round(docs_s, 1), "rss_mb": rss, "query_ms_median": round(statistics.median(lat), 1),
           "file_mb": round((MODELS_DIR / MODELS[model]["file"]).stat().st_size / 1e6, 1)}
    (OUT / f"speed_{model}.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(model, res)


def analyze() -> None:
    summary = {}
    for m in MODELS:
        s = {}
        try:
            rows = [json.loads(l) for l in (OUT / f"d1_{m}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
            s["d1_turn_any@10"] = round(100 * statistics.mean(r["turn_any@10"] for r in rows), 1)
            s["d1_n"] = len(rows)
        except FileNotFoundError:
            pass
        for name in ("d2", "d3", "speed"):
            p = OUT / f"{name}_{m}.json"
            if p.exists():
                s[name] = json.loads(p.read_text(encoding="utf-8"))
        summary[m] = s
    keys = {
        "D1": lambda s: s.get("d1_turn_any@10"),
        "D2": lambda s: s.get("d2", {}).get("all"),
        "D3_mono": lambda s: s.get("d3", {}).get("mono_macro", {}).get("ndcg@10"),
        "D3_cross": lambda s: s.get("d3", {}).get("cross_macro_ndcg@10"),
    }
    best = {k: max((f(s) for s in summary.values() if f(s) is not None), default=None) for k, f in keys.items()}
    qualifies = {m: all(f(s) is not None and best[k] is not None and f(s) >= best[k] - 3 for k, f in keys.items())
                 for m, s in summary.items()}
    size = lambda m: summary[m].get("speed", {}).get("file_mb", 1e9)
    q = [m for m, ok in qualifies.items() if ok]
    if q:
        winner = sorted(q, key=lambda m: (size(m), -(keys["D3_cross"](summary[m]) or 0)))[0]
    else:
        winner = max(summary, key=lambda m: keys["D3_cross"](summary[m]) or -1)
    summary["_decision"] = {"best": best, "qualifies": qualifies, "winner": winner}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"d1": d1, "d2": d2, "d3": d3, "speed": speed}.get(cmd, lambda _=None: analyze())(*sys.argv[2:3])
