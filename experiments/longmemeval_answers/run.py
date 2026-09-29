"""E20: LongMemEval answers, Aura capture vs mem0. See PROTOCOL.md.

Run in the mem0 venv with the E18 Aura package on PYTHONPATH; GOOGLE_API_KEY in
the repository's .env (never printed):
    python run.py retrieve   -> retrieved.jsonl (E19 stores, top 10 per arm)
    python run.py answer     -> reader answers (cache/gemini.jsonl)
    python run.py judge      -> judgements (cache/gemini.jsonl)
    python run.py analyze    -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import statistics
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
_spec = importlib.util.spec_from_file_location("e19run", HERE.parent / "longmemeval_retrieval" / "run.py")
e19 = importlib.util.module_from_spec(_spec)
sys.modules["e19run"] = e19
_spec.loader.exec_module(e19)

MODEL = "gemini-3.8-flash"
ARMS = ("M", "A-cap", "A-flat")
MAX_OUTPUT = 4096  # includes the model's thinking

# aegis-memory benchmarks/memory/longmemeval/run_longmemeval.py (Apache-2.0)
READER_SYSTEM = (
    "You are a helpful assistant with long-term memory of past conversations with the user. "
    "You are given excerpts retrieved from that memory, each tagged with the session time it "
    "occurred. Answer the user's question based only on these memories. Pay attention to "
    "session timestamps when the question involves dates or durations. Answer concisely and "
    "directly. If the memories do not contain the information needed to answer, say that you "
    "do not have that information — do not guess."
)


# Official LongMemEval judge prompts, verbatim from
# https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py
# (via aegis-memory's vendored copy).
def get_anscheck_prompt(task, question, answer, response, abstention=False):
    if not abstention:
        if task in ['single-session-user', 'single-session-assistant', 'multi-session']:
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == 'temporal-reasoning':
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == 'knowledge-update':
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == 'single-session-preference':
            template = "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        else:
            raise NotImplementedError
        return template.format(question, answer, response)
    template = "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only."
    return template.format(question, answer, response)

# ------------------------------------------------------------------ Gemini


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


KEY = _key()
_lock = threading.Lock()
CACHE_PATH = HERE / "cache" / "gemini.jsonl"
(HERE / "cache").mkdir(exist_ok=True)
_cache: dict[str, dict] = {}
if CACHE_PATH.exists():
    for line in CACHE_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rec = json.loads(line)
            _cache[rec["k"]] = rec


def gemini(system: str | None, user: str) -> dict:
    k = hashlib.sha256(json.dumps([MODEL, system, user, MAX_OUTPUT]).encode()).hexdigest()
    if k in _cache:
        return _cache[k]
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"maxOutputTokens": MAX_OUTPUT}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    req_body = json.dumps(body).encode()
    for attempt in range(10):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=req_body, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
            rec = {"k": k, "text": text, "usage": d.get("usageMetadata", {}),
                   "finish": (d.get("candidates") or [{}])[0].get("finishReason")}
            with _lock:
                _cache[k] = rec
                with CACHE_PATH.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return rec
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {e.code}: {e.read()[:300]!r}") from None
        except (urllib.error.URLError, TimeoutError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("Gemini: retries exhausted")

# ------------------------------------------------------------------ phases


def questions() -> list[dict]:
    return e19.select(e19.load(), "sample")


def retrieve() -> None:
    path = HERE / "retrieved.jsonl"
    done = {json.loads(l)["question_id"] for l in path.read_text(encoding="utf-8").splitlines()
            if l.strip()} if path.exists() else set()
    for q in questions():
        if q["question_id"] in done:
            continue
        ts = e19.turns(q)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            root = Path(d)
            ranked = {"M": e19.run_mem0(ts, q["question"], root)[0],
                      "A-cap": e19.run_aura(ts, q["question"], root, capture=True)[0],
                      "A-flat": e19.run_aura(ts, q["question"], root, capture=False)[0]}
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"question_id": q["question_id"], "ranked": ranked}, ensure_ascii=False) + "\n")
        print(json.dumps({"retrieved": q["question_id"]}), flush=True)


def context_for(q: dict, ranked: list[str]) -> str:
    where: dict[str, tuple[str, str]] = {}
    for date, session in zip(q["haystack_dates"], q["haystack_sessions"]):
        for t in session:
            where.setdefault(t["content"], (date, t["role"]))
    blocks = []
    for text in ranked:
        date, role = where.get(text, ("unknown", "user"))
        blocks.append(f"[Session time: {date}]\n{role.capitalize()}: {text}")
    return "\n\n---\n\n".join(blocks)


def reader_prompt(q: dict, ranked: list[str]) -> str:
    return (f"Current date: {q['question_date']}\n\n"
            f"Retrieved memories:\n\n{context_for(q, ranked)}\n\n"
            f"Question: {q['question']}")


def load_retrieved() -> dict[str, dict]:
    return {r["question_id"]: r["ranked"] for r in
            (json.loads(l) for l in (HERE / "retrieved.jsonl").read_text(encoding="utf-8").splitlines() if l.strip())}


def jobs():
    qs = {q["question_id"]: q for q in questions()}
    retrieved = load_retrieved()
    for qid, q in qs.items():
        for arm in ARMS:
            yield q, arm, retrieved[qid][arm]


def answer_phase() -> None:
    work = list(jobs())
    with ThreadPoolExecutor(4) as pool:
        for i, _ in enumerate(pool.map(lambda j: gemini(READER_SYSTEM, reader_prompt(j[0], j[2])), work)):
            if i % 30 == 29:
                print(json.dumps({"answered": i + 1, "of": len(work)}), flush=True)


def judge_prompt(q: dict, answer: str) -> str:
    return get_anscheck_prompt(q["question_type"], q["question"], q["answer"], answer,
                               abstention="_abs" in q["question_id"])


def judge_phase() -> None:
    work = list(jobs())

    def one(j):
        q, arm, ranked = j
        hyp = gemini(READER_SYSTEM, reader_prompt(q, ranked))["text"]
        return gemini(None, judge_prompt(q, hyp))

    with ThreadPoolExecutor(4) as pool:
        for i, _ in enumerate(pool.map(one, work)):
            if i % 30 == 29:
                print(json.dumps({"judged": i + 1, "of": len(work)}), flush=True)


def analyze() -> None:
    rows = []
    for q, arm, ranked in jobs():
        ans = gemini(READER_SYSTEM, reader_prompt(q, ranked))
        verdict = gemini(None, judge_prompt(q, ans["text"]))
        rows.append({"question_id": q["question_id"], "type": q["question_type"], "arm": arm,
                     "correct": verdict["text"].strip().lower().startswith("yes") or "yes" in verdict["text"].lower()[:10],
                     "answer": ans["text"], "verdict": verdict["text"], "empty_answer": not ans["text"],
                     "reader_tokens": ans["usage"].get("totalTokenCount", 0),
                     "context_chars": len(context_for(q, ranked))})
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

    def acc(rs):
        return round(sum(r["correct"] for r in rs) / len(rs), 3) if rs else None

    overall = {a: acc([r for r in rows if r["arm"] == a]) for a in ARMS}
    types = sorted({r["type"] for r in rows})
    by_type = {t: {a: acc([r for r in rows if r["arm"] == a and r["type"] == t]) for a in ARMS} for t in types}
    ssa = by_type["single-session-assistant"]
    gates = {"H1": overall["A-cap"] >= overall["M"] - 0.05,
             "H2": overall["A-cap"] >= overall["A-flat"] - 0.05,
             "H3": ssa["A-cap"] >= ssa["A-flat"] - 0.10}
    extra = {a: {"empty_answers": sum(r["empty_answer"] for r in rows if r["arm"] == a),
                 "context_chars_median": statistics.median(r["context_chars"] for r in rows if r["arm"] == a),
                 "reader_tokens_total": sum(r["reader_tokens"] for r in rows if r["arm"] == a)} for a in ARMS}
    usage = {"calls": len(_cache),
             "prompt_tokens": sum(c["usage"].get("promptTokenCount", 0) for c in _cache.values()),
             "output_tokens": sum(c["usage"].get("candidatesTokenCount", 0) + c["usage"].get("thoughtsTokenCount", 0)
                                  for c in _cache.values())}
    result = {"model": MODEL, "questions": len(rows) // len(ARMS), "gates": gates, "accuracy": overall,
              "by_type": by_type, "arms": extra, "usage": usage}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "analyze"
    {"retrieve": retrieve, "answer": answer_phase, "judge": judge_phase, "analyze": analyze}[cmd]()


if __name__ == "__main__":
    main()
