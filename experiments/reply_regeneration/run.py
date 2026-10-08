"""E64: can an AI's past reply be recovered by asking again, and does the model matter? See PROTOCOL.md. Test only.

Run with E:/remy/app/.venv (aura and mem0 are stubbed; only E20's official judge prompt and key are used).
GOOGLE_API_KEY in the repo .env (never printed).
    python run.py run       -> rows.jsonl
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import threading
import time
import types
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
(HERE / "cache").mkdir(exist_ok=True)
DATA = Path(r"D:\Aura-clean\target\aura-local\external-benchmarks\longmemeval\longmemeval_s.json")
LITE, FLASH = "gemini-3.1-flash-lite", "gemini-2.5-flash"
PRICE = {LITE: (0.25, 1.50), FLASH: (0.30, 2.50)}
BUDGET_USD = 1.5

sys.modules.setdefault("aura", types.SimpleNamespace(Aura=None, Level=None))
_e56_src = (EXP / "journal_lookup" / "run.py").read_text(encoding="utf-8")
_stub = next(n for n in __import__("ast").parse(_e56_src).body if getattr(n, "name", "") == "_stub_mem0")
_scope = {"types": types, "sys": sys}
exec(__import__("ast").get_source_segment(_e56_src, _stub), _scope)  # E56's mem0 stub: E19 imports mem0, E64 never uses it
_scope["_stub_mem0"]()
_spec = importlib.util.spec_from_file_location("e20", EXP / "longmemeval_answers" / "run.py")
e20 = importlib.util.module_from_spec(_spec)
sys.modules["e20"] = e20
_spec.loader.exec_module(e20)

# ------------------------------------------------------------------ Gemini (own cache)

_lock = threading.Lock()
CACHE = HERE / "cache" / "gemini.jsonl"
_cache: dict = {}
if CACHE.exists():
    for line in CACHE.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            _cache[r["k"]] = r


def spent() -> float:
    with _lock:
        return sum(c["usage"].get("promptTokenCount", 0) * PRICE[c["model"]][0] / 1e6
                   + (c["usage"].get("candidatesTokenCount", 0) + c["usage"].get("thoughtsTokenCount", 0)) * PRICE[c["model"]][1] / 1e6
                   for c in _cache.values())


def gemini(model: str, user: str, max_out: int, temperature: float = 0.0, sample: int = 0, system: str | None = None) -> str:
    k = hashlib.sha256(json.dumps([model, system, user, max_out, temperature, sample]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _cache[k]["text"]
    if spent() > BUDGET_USD:
        raise SystemExit("budget reached")
    cfg = {"temperature": temperature, "maxOutputTokens": max_out}
    if model == FLASH:
        cfg["thinkingConfig"] = {"thinkingBudget": 0}
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": cfg}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    data = json.dumps(body).encode()
    for attempt in range(10):
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                     data=data, headers={"x-goog-api-key": e20.KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "model": model, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")).strip(),
                   "usage": d.get("usageMetadata", {})}
            with _lock:
                _cache[k] = rec
                with CACHE.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return rec["text"]
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt))
                continue
            raise RuntimeError(f"Gemini HTTP {err.code}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("retries exhausted")

# ------------------------------------------------------------------ prompts

REGEN = """Here is a conversation between a user and an AI assistant. The assistant's earlier replies were not kept.

{turns}

Reply to the user's last message as the assistant."""
CONTAINS = """Gold information: {gold}

An assistant's reply:
{reply}

Does this reply contain the gold information (the same specific names, numbers or items)? Answer only yes or no."""
COMPARE = """Two replies an assistant gave to the same message.

Reply 1:
{a}

Reply 2:
{b}

Do they give the same specific content (names, numbers, items, steps)? Answer with one word: same, partly or different."""
READ = """Current date: {qdate}

A past conversation (session time: {sdate}):

{session}

Question: {question}"""


def load_questions() -> list[dict]:
    out = []
    for q in json.loads(DATA.read_text(encoding="utf-8")):
        if q["question_type"] != "single-session-assistant" or q["question_id"].endswith("_abs"):
            continue
        for sid, date, s in zip(q["haystack_session_ids"], q["haystack_dates"], q["haystack_sessions"]):
            if sid not in q["answer_session_ids"]:
                continue
            ev = [i for i, t in enumerate(s) if t.get("has_answer")]
            if len(ev) == 1 and s[ev[0]]["role"] == "assistant":
                out.append({"q": q, "session": s, "date": date, "i": ev[0]})
    return out


def regen_prompt(session: list[dict], i: int) -> str:
    lines = []
    for t in session[:i]:
        if t["role"] == "user":
            lines.append(f"User: {t['content']}")
        else:
            lines.append("Assistant: (reply not kept)")
    return REGEN.format(turns="\n\n".join(lines))


def render(session: list[dict], i: int, mode: str, regen: str | None = None) -> str:
    lines = []
    for k, t in enumerate(session):
        if t["role"] == "user":
            lines.append(f"User: {t['content']}")
        elif mode == "A":
            lines.append(f"Assistant: {t['content']}")
        elif mode in ("C", "D") and k == i:
            lines.append(f"Assistant: {regen}")
    return "\n\n".join(lines)


def yes(text: str) -> bool:
    return text.strip().lower().startswith("yes")


def one(item: dict) -> dict:
    q, s, i = item["q"], item["session"], item["i"]
    rp = regen_prompt(s, i)
    c_reply = gemini(LITE, rp, 2048, temperature=1.0, sample=1)
    d_reply = gemini(FLASH, rp, 2048, temperature=1.0, sample=1)
    s_reply = gemini(LITE, rp, 2048, temperature=1.0, sample=2)
    row = {"qid": q["question_id"], "question": q["question"], "gold": str(q["answer"])[:300]}
    for arm, mode, regen in (("A", "A", None), ("B", "B", None), ("C", "C", c_reply), ("D", "D", d_reply)):
        prompt = READ.format(qdate=q["question_date"], sdate=item["date"], session=render(s, i, mode, regen), question=q["question"])
        ans = gemini(LITE, prompt, 1024, system=e20.READER_SYSTEM)
        row[arm] = yes(gemini(LITE, e20.get_anscheck_prompt(q["question_type"], q["question"], q["answer"], ans), 64))
    for name, reply in (("orig", s[i]["content"]), ("C", c_reply), ("D", d_reply)):
        row[f"contains_{name}"] = yes(gemini(LITE, CONTAINS.format(gold=q["answer"], reply=reply), 8))
    # part 2: same model asked again (S vs O = C's sample) vs another model (M = D's reply vs O)
    row["S_vs_O"] = gemini(LITE, COMPARE.format(a=c_reply, b=s_reply), 8).strip().lower().strip(".")
    row["M_vs_O"] = gemini(LITE, COMPARE.format(a=c_reply, b=d_reply), 8).strip().lower().strip(".")
    row["len"] = {"orig": len(s[i]["content"]), "C": len(c_reply), "D": len(d_reply)}
    return row


def run() -> None:
    items = load_questions()
    print(json.dumps({"questions": len(items)}), flush=True)
    with ThreadPoolExecutor(6) as ex:
        rows = list(ex.map(one, items))
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(json.dumps({"done": len(rows), "usd": round(spent(), 3)}))


def pct(xs):
    xs = list(xs)
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def analyze() -> None:
    rows = [json.loads(x) for x in (HERE / "rows.jsonl").read_text(encoding="utf-8").split("\n") if x.strip()]
    norm = lambda v: v if v in ("same", "partly", "different") else "other"
    res = {"questions": len(rows),
           "accuracy": {a: pct(r[a] for r in rows) for a in ("A", "B", "C", "D")},
           "gold_in_reply": {k: pct(r[f"contains_{k}"] for r in rows) for k in ("orig", "C", "D")},
           "C_and_D": {"both_right": sum(r["C"] and r["D"] for r in rows), "only_C": sum(r["C"] and not r["D"] for r in rows),
                       "only_D": sum(r["D"] and not r["C"] for r in rows), "neither": sum(not r["C"] and not r["D"] for r in rows)},
           "same_model_again_vs_first": {v: pct(norm(r["S_vs_O"]) == v for r in rows) for v in ("same", "partly", "different", "other")},
           "other_model_vs_first": {v: pct(norm(r["M_vs_O"]) == v for r in rows) for v in ("same", "partly", "different", "other")}}
    a, b, c, d = (res["accuracy"][k] for k in "ABCD")
    res["recovered_share"] = {"C": round((c - b) / (a - b), 2) if a != b else None, "D": round((d - b) / (a - b), 2) if a != b else None}
    res["hypotheses"] = {
        "G1_regeneration_recovers_little": c - b <= 0.5 * (a - b),
        "G2_model_matters": res["same_model_again_vs_first"]["same"] - res["other_model_vs_first"]["same"] >= 15,
        "G3_gold_survives_under_half": res["gold_in_reply"]["C"] < 50 and res["gold_in_reply"]["D"] < 50}
    res["usd"] = round(spent(), 3)
    (HERE / "results.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    {"run": run, "analyze": analyze}[sys.argv[1]]()
