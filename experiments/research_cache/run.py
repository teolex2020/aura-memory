"""E33: research cache — research once into memory vs search every time.

See PROTOCOL.md. Fixed before the data exists:
- build budget: BUILD_ASPECTS grounded calls per topic, prompted only with
  the topic title and description (never the questions);
- cached statements are Gemini's grounding supports: each text segment with
  the source pages it was grounded in, one Aura record per segment;
- answer model gemini-3.1-flash-lite, judge gemini-2.5-flash-lite, both at
  temperature 0.

Run in the mem0 venv with the current core on PYTHONPATH (Ollama bge-m3 up):
    python run.py hash | build | answer R|C|C-LEX | judge | cite | analyze
"""

from __future__ import annotations

import hashlib
import html
import importlib.util
import json
import random
import re
import statistics
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / "topics.jsonl"
OUT = HERE / "results"
OUT.mkdir(exist_ok=True)
MODEL = "gemini-3.1-flash-lite"
JUDGE = "gemini-2.5-flash-lite"
SEARCH_FEE = 14 / 1000  # $ per search request beyond the free tier
PRICE = {MODEL: (0.25, 1.50), JUDGE: (0.10, 0.40)}  # $ per 1M input / output tokens
BUILD_ASPECTS = [
    "an overview: what it is, who is involved, where and when",
    "a timeline of key events with exact dates",
    "key numbers, amounts, results and statistics",
    "the people, companies and organisations involved and their roles",
    "the latest developments and what is expected next",
]
CITE_SAMPLE = 60

_spec = importlib.util.spec_from_file_location("e30", HERE.parent / "control_facts" / "run.py")
e30 = importlib.util.module_from_spec(_spec)
sys.modules["e30"] = e30
_spec.loader.exec_module(e30)


def topics() -> list[dict]:
    return [json.loads(l) for l in DATA.read_text(encoding="utf-8").splitlines() if l.strip()]


def gemini(model: str, user: str, system: str | None = None, grounded: bool = False) -> dict:
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 1500 if grounded else 400}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if grounded:
        body["tools"] = [{"google_search": {}}]
    data = json.dumps(body).encode()
    for attempt in range(8):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=data, headers={"x-goog-api-key": e30._gemini_key(), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 503) and attempt < 7:
                time.sleep(2 ** attempt)
                continue
            raise
    return {}


def text_of(resp: dict) -> str:
    parts = (resp.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def cost(resp: dict, model: str) -> dict:
    u = resp.get("usageMetadata", {})
    gm = (resp.get("candidates") or [{}])[0].get("groundingMetadata", {})
    searches = len(gm.get("webSearchQueries") or [])
    pin, pout = PRICE[model]
    tokens_in = u.get("promptTokenCount", 0) + u.get("toolUsePromptTokenCount", 0)
    tokens_out = u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
    return {"in": tokens_in, "out": tokens_out, "searches": searches,
            "usd": tokens_in * pin / 1e6 + tokens_out * pout / 1e6 + searches * SEARCH_FEE}


def resolve(uri: str) -> str:
    """The real page behind a grounding redirect link."""
    try:
        req = urllib.request.Request(uri, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.geturl()
    except Exception:  # noqa: BLE001
        return uri


def hash_data() -> None:
    digest = hashlib.sha256(DATA.read_bytes()).hexdigest()
    (HERE / "data" / "SHA256").write_text(f"{digest}  topics.jsonl\n", encoding="utf-8")
    print(digest)


# ------------------------------------------------------------------ build (C)

def build() -> None:
    out = OUT / "cache.jsonl"
    statements, costs = [], []
    for t in topics():
        lang = "Write in Ukrainian." if t["lang"] == "uk" else "Write in English."
        for aspect in BUILD_ASPECTS:
            prompt = (f"Research this topic on the web and write a detailed factual brief about {aspect}. "
                      f"Topic: {t['topic']}. {t['description']} Use specific names, numbers and dates. {lang}")
            resp = gemini(MODEL, prompt, grounded=True)
            costs.append({"topic": t["id"], "aspect": aspect, **cost(resp, MODEL)})
            cand = (resp.get("candidates") or [{}])[0]
            gm = cand.get("groundingMetadata", {})
            chunks = [c.get("web", {}) for c in gm.get("groundingChunks", [])]
            for sup in gm.get("groundingSupports", []):
                seg = sup.get("segment", {}).get("text", "").strip()
                idx = sup.get("groundingChunkIndices") or []
                if len(seg) < 20 or not idx:
                    continue
                urls = [chunks[i].get("uri", "") for i in idx if i < len(chunks)]
                statements.append({"topic": t["id"], "text": seg, "sources": urls,
                                   "titles": [chunks[i].get("title", "") for i in idx if i < len(chunks)]})
            print(t["id"], aspect[:30], len(statements), flush=True)
    for s in statements:
        s["urls"] = [resolve(u) for u in s["sources"]]
    out.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in statements) + "\n", encoding="utf-8")
    (OUT / "build_cost.json").write_text(json.dumps(costs, indent=2), encoding="utf-8")
    print("statements", len(statements), "usd", round(sum(c["usd"] for c in costs), 3))


# ------------------------------------------------------------------ answers

ANSWER_SYSTEM = ("Answer the user's question in one short sentence, in the question's language. "
                 "Use only the memory context. If it does not contain the answer, say you don't know.")


def memory_store(emb: bool):
    from aura import Aura, Level
    _e = importlib.util.spec_from_file_location("e19", HERE.parent / "longmemeval_retrieval" / "run.py")
    e19 = importlib.util.module_from_spec(_e)
    sys.modules["e19"] = e19
    _e.loader.exec_module(e19)
    d = tempfile.mkdtemp()
    brain = Aura(d)
    if emb:
        brain.set_embedding_fn(e19.embed)
    for s in (json.loads(l) for l in (OUT / "cache.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()):
        brain.store(s["text"], level=Level.Domain, source_type="retrieved", deduplicate=True,
                    metadata={"url": (s["urls"] or [""])[0][:500], "topic": s["topic"], "imported": "true"})
    return brain


def answer(arm: str) -> None:
    out = OUT / f"answers_{arm}.jsonl"
    done = {json.loads(l)["id"] for l in out.read_text(encoding="utf-8").splitlines() if l.strip()} if out.exists() else set()
    brain = memory_store(emb=(arm == "C")) if arm.startswith("C") else None
    with out.open("a", encoding="utf-8") as f:
        for t in topics():
            for q in t["questions"]:
                if q["id"] in done:
                    continue
                if arm == "R":
                    resp = gemini(MODEL, q["question"] + " Answer in one short sentence.", grounded=True)
                    context_chars = 0
                else:
                    context = brain.recall(q["question"])
                    context_chars = len(context)
                    resp = gemini(MODEL, f"Memory context:\n{context}\n\nQuestion: {q['question']}", system=ANSWER_SYSTEM)
                row = {"id": q["id"], "answer": text_of(resp).strip(), "context_chars": context_chars, **cost(resp, MODEL)}
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                f.flush()
    if brain:
        brain.close()
    print(arm, "done")


# ------------------------------------------------------------------ judging

JUDGE_PROMPT = ("Question: {q}\nReference answer: {gold}\nCandidate answer: {a}\n\n"
                "Does the candidate answer state the same essential fact as the reference (minor wording, "
                "units or extra detail are fine; 'I don't know' is wrong)? Reply with JSON only: "
                '{{"correct": true|false}}')


def judge() -> None:
    gold = {q["id"]: q for t in topics() for q in t["questions"]}
    for path in sorted(OUT.glob("answers_*.jsonl")):
        out = path.with_name(path.stem.replace("answers_", "judged_") + ".jsonl")
        done = {json.loads(l)["id"] for l in out.read_text(encoding="utf-8").splitlines() if l.strip()} if out.exists() else set()
        with out.open("a", encoding="utf-8") as f:
            for row in map(json.loads, path.read_text(encoding="utf-8").splitlines()):
                if row["id"] in done:
                    continue
                q = gold[row["id"]]
                resp = gemini(JUDGE, JUDGE_PROMPT.format(q=q["question"], gold=q["answer"], a=row["answer"]))
                m = re.search(r'"correct"\s*:\s*(true|false)', text_of(resp))
                f.write(json.dumps({"id": row["id"], "correct": bool(m and m.group(1) == "true"),
                                    **{"judge_" + k: v for k, v in cost(resp, JUDGE).items()}}) + "\n")
        print(out.name)


def page_text(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(600_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""
    raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw))).strip()


def cite() -> None:
    statements = [json.loads(l) for l in (OUT / "cache.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    sample = random.Random(33).sample(statements, min(CITE_SAMPLE, len(statements)))
    rows = []
    for s in sample:
        text = page_text((s["urls"] or [""])[0])[:20000]
        if not text:
            rows.append({"text": s["text"], "url": (s["urls"] or [""])[0], "fetched": False, "supported": None})
            continue
        resp = gemini(JUDGE, f"Page text:\n{text}\n\nStatement: {s['text']}\n\nIs the statement supported by the page? "
                             'Reply with JSON only: {"supported": true|false}')
        m = re.search(r'"supported"\s*:\s*(true|false)', text_of(resp))
        rows.append({"text": s["text"], "url": s["urls"][0], "fetched": True,
                     "supported": bool(m and m.group(1) == "true"), **cost(resp, JUDGE)})
    (OUT / "citations.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    ok = [r for r in rows if r["fetched"]]
    print("fetched", len(ok), "supported", sum(r["supported"] for r in ok))


# ------------------------------------------------------------------ analysis

def analyze() -> None:
    qs = {q["id"]: (t, q) for t in topics() for q in t["questions"]}
    summary = {}
    build_usd = sum(c["usd"] for c in json.loads((OUT / "build_cost.json").read_text()))
    for path in sorted(OUT.glob("judged_*.jsonl")):
        arm = path.stem.replace("judged_", "")
        judged = {r["id"]: r for r in map(json.loads, path.read_text(encoding="utf-8").splitlines())}
        answers = {r["id"]: r for r in map(json.loads, (OUT / f"answers_{arm}.jsonl").read_text(encoding="utf-8").splitlines())}
        acc = 100 * statistics.mean(r["correct"] for r in judged.values())
        per_q = statistics.mean(a["usd"] for a in answers.values())
        s = {"accuracy": round(acc, 1), "n": len(judged), "usd_per_question": round(per_q, 5),
             "by_lang": {l: round(100 * statistics.mean(judged[i]["correct"] for i in judged if qs[i][0]["lang"] == l), 1)
                         for l in ("uk", "en")},
             "by_kind": {k: round(100 * statistics.mean(judged[i]["correct"] for i in judged if qs[i][1]["kind"] == k), 1)
                         for k in ("fact", "number_or_date", "synthesis")}}
        if arm.startswith("C"):
            s["usd_per_question_at_5_incl_build"] = round(per_q + build_usd / (6 * 5), 5)
            s["median_context_chars"] = statistics.median(a["context_chars"] for a in answers.values())
        summary[arm] = s
    summary["build_usd"] = round(build_usd, 4)
    cites = json.loads((OUT / "citations.json").read_text(encoding="utf-8")) if (OUT / "citations.json").exists() else []
    fetched = [c for c in cites if c["fetched"]]
    summary["citations"] = {"sampled": len(cites), "fetched": len(fetched),
                            "supported_pct": round(100 * statistics.mean(c["supported"] for c in fetched), 1) if fetched else None}
    if "R" in summary and "C" in summary:
        r, c = summary["R"], summary["C"]
        summary["gates"] = {
            "G1_accuracy_C>=R-5": c["accuracy"] >= r["accuracy"] - 5,
            "G2_cost_C<=R/5_at_5q": c["usd_per_question_at_5_incl_build"] <= r["usd_per_question"] / 5,
            "G3_citations>=90": (summary["citations"]["supported_pct"] or 0) >= 90,
        }
        # break-even questions per topic: build/6 + n*c <= n*r
        diff = r["usd_per_question"] - c["usd_per_question"]
        summary["break_even_questions_per_topic"] = round((build_usd / 6) / diff, 1) if diff > 0 else None
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"hash": hash_data, "build": build, "judge": judge, "cite": cite, "analyze": analyze,
     "answer": lambda: answer(sys.argv[2])}[cmd]()
