"""E42: does the control-fact checker hold on public data (PrefEval)? See PROTOCOL.md.

Plain Python 3; GOOGLE_API_KEY in the repository's .env (never printed).
    python run.py generate   -> A0/A1 answers (cache/gemini.jsonl)
    python run.py judge      -> official PrefEval violation judge (gemini-2.5-flash)
    python run.py check      -> E30 checker (gemini-3.1-flash-lite)
    python run.py analyze    -> results.json
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BENCH = Path(r"E:\aura-benchmarks")
DATA = BENCH / "siyanzhao__prefeval_explicit" / "data" / "train-00000-of-00001.jsonl"
JUDGE_PROMPT = BENCH / "PrefEval" / "error_type" / "check_violation.txt"
JUDGE_SYSTEM = ("You are a helpful assistant in evaluating an AI assistant's reponse. You should be fair "
                "and strict and follow the user's instruction")  # PrefEval's own system prompt, verbatim
GEN, JUDGE, CHECK = "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.1-flash-lite"
PRICE = {"gemini-3.1-flash-lite": (0.25, 1.50), "gemini-2.5-flash": (0.30, 2.50)}
BUDGET_USD = 5.0
ARMS = ("A0", "A1")

sys.path.insert(0, str(HERE.parent / "control_facts"))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("e30", HERE.parent / "control_facts" / "run.py")
e30 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(e30)


def _key() -> str:
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GOOGLE_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    raise SystemExit("GOOGLE_API_KEY not found in .env")


KEY = _key()
(HERE / "cache").mkdir(exist_ok=True)
CACHE = HERE / "cache" / "gemini.jsonl"
_lock = threading.Lock()
_cache: dict[str, dict] = {}
if CACHE.exists():
    for line in CACHE.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            r = json.loads(line)
            _cache[r["k"]] = r


def spent() -> float:
    with _lock:
        total = 0.0
        for c in _cache.values():
            pin, pout = PRICE[c["model"]]
            u = c["usage"]
            total += u.get("promptTokenCount", 0) * pin / 1e6
            total += (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * pout / 1e6
        return total


def gemini(model: str, system: str | None, user: str, max_out: int, json_out: bool = False) -> str:
    k = hashlib.sha256(json.dumps([model, system, user, max_out, json_out]).encode()).hexdigest()
    with _lock:
        if k in _cache:
            return _cache[k]["text"]
    if spent() > BUDGET_USD:
        raise SystemExit(f"budget ${BUDGET_USD} reached")
    config = {"temperature": 0, "maxOutputTokens": max_out}
    if json_out:
        config["responseMimeType"] = "application/json"
    if model == "gemini-2.5-flash":
        config["thinkingConfig"] = {"thinkingBudget": 0}
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": config}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    data = json.dumps(body).encode()
    for attempt in range(10):
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=data, headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=300).read())
            parts = (d.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            rec = {"k": k, "model": model, "text": "".join(p.get("text", "") for p in parts if not p.get("thought")),
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
            raise RuntimeError(f"Gemini HTTP {err.code}: {err.read()[:300]!r}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError("Gemini: retries exhausted")

# ------------------------------------------------------------------ phases


def items() -> list[dict]:
    rows = [json.loads(l) for l in DATA.read_text(encoding="utf-8").split("\n") if l.strip()]
    return [{"id": f"p{i:04d}", **r} for i, r in enumerate(rows)]


def answer(item: dict, arm: str) -> str:
    system = f"The user told you earlier: {item['preference']}" if arm == "A1" else None
    return gemini(GEN, system, item["question"], 600)


def judge(item: dict, arm: str) -> bool | None:
    prompt = (JUDGE_PROMPT.read_text(encoding="utf-8")
              .replace("{preference}", item["preference"])
              .replace("{question}", item["question"])
              .replace("{end_generation}", answer(item, arm)))
    reply = gemini(JUDGE, JUDGE_SYSTEM, prompt, 200)
    m = re.search(r"<answer>\s*(yes|no)\s*</answer>", reply, re.I)
    return (m.group(1).lower() == "yes") if m else None


def check(item: dict, arm: str) -> dict:
    candidate = {"kind": "answer", "text": answer(item, arm)}
    reply = gemini(CHECK, e30.SYSTEM, e30.prompt([item["preference"]], candidate), 200, json_out=True)
    return e30.parse(reply)


def pool(fn, label: str) -> None:
    jobs = [(i, a) for i in items() for a in ARMS]
    with ThreadPoolExecutor(8) as ex:
        for n, _ in enumerate(ex.map(lambda j: fn(*j), jobs), 1):
            if n % 250 == 0:
                print(json.dumps({label: n, "of": len(jobs), "usd": round(spent(), 3)}), flush=True)


def analyze() -> None:
    rows = []
    for it in items():
        for arm in ARMS:
            ref, chk = judge(it, arm), check(it, arm)
            rows.append({"id": it["id"], "arm": arm, "topic": it["topic"], "ref": ref,
                         "checker": chk["violates"], "parsed": chk["parsed"]})
    (HERE / "rows.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    valid = [r for r in rows if r["ref"] is not None]

    def stats(rs):
        pos = [r for r in rs if r["ref"]]
        neg = [r for r in rs if not r["ref"]]
        tp = sum(r["checker"] for r in pos)
        fp = sum(r["checker"] for r in neg)
        n = len(rs)
        po = (tp + len(neg) - fp) / n if n else 0
        pe = ((tp + fp) / n * len(pos) / n + (n - tp - fp) / n * len(neg) / n) if n else 0
        return {"n": n, "ref_violations": len(pos),
                "caught_percent": round(100 * tp / len(pos), 1) if pos else None,
                "false_alarm_percent": round(100 * fp / len(neg), 1) if neg else None,
                "kappa": round((po - pe) / (1 - pe), 3) if pe < 1 else None}

    overall = stats(valid)
    result = {
        "overall": overall,
        "by_arm": {a: stats([r for r in valid if r["arm"] == a]) for a in ARMS},
        "by_topic": {t: stats([r for r in valid if r["topic"] == t]) for t in sorted({r["topic"] for r in valid})},
        "unparsed_reference": sum(r["ref"] is None for r in rows),
        "unparsed_checker": sum(not r["parsed"] for r in rows),
        "gates": {"P0": overall["ref_violations"] >= 100,
                  "P1": (overall["caught_percent"] or 0) >= 90,
                  "P2": (overall["false_alarm_percent"] if overall["false_alarm_percent"] is not None else 100) <= 5},
        "usd": round(spent(), 3),
    }
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "by_topic"}, indent=1))


if __name__ == "__main__":
    {"generate": lambda: pool(answer, "generated"), "judge": lambda: pool(judge, "judged"),
     "check": lambda: pool(check, "checked"), "analyze": analyze}[sys.argv[1]]()
