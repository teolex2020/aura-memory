#!/usr/bin/env python3
"""Compare ordinary candidate context with citation-locked opened evidence."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path


SYSTEM = """You answer memory questions using only EVIDENCE.
Return exactly one JSON object and nothing else:
{"answer":"short answer or UNKNOWN","citations":["record-id"]}
If evidence is absent, conflicting, unverified, or insufficient, answer UNKNOWN with an empty citation list.
Every non-UNKNOWN answer must cite all records needed to support it. Never invent record IDs."""


def normalize(value: str) -> str:
    return " ".join(value.casefold().split())


def canonical_citation(value: object) -> str:
    citation = str(value).strip().strip("[]")
    for prefix in ("record_id=", "record-id="):
        if prefix in citation:
            citation = citation.split(prefix, 1)[1]
            break
    return citation.split(";", 1)[0].strip()


def parse_answer(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```")
        text = text.removesuffix("```").strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {"answer": text, "citations": [], "parse_error": True}
    answer = str(value.get("answer", "UNKNOWN"))
    citations = value.get("citations", [])
    if not isinstance(citations, list):
        citations = []
    return {
        "answer": answer,
        "citations": [canonical_citation(item) for item in citations],
        "parse_error": False,
    }


def complete(base_url: str, model: str, context: str, question: str) -> tuple[dict, float]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"EVIDENCE:\n{context}\nQUESTION:\n{question}"},
        ],
        "temperature": 0.0,
        "top_p": 1.0,
        "seed": 42,
        "max_tokens": 160,
        "chat_template_kwargs": {"enable_thinking": False},
        "stream": False,
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=300) as response:
        body = json.load(response)
    latency = time.perf_counter() - started
    raw = body["choices"][0]["message"]["content"]
    parsed = parse_answer(raw)
    parsed["raw"] = raw
    return parsed, latency


def score(case: dict, output: dict, arm: str) -> dict:
    expected_terms = [normalize(term) for term in case["expected_answer"].split("|")]
    answer = normalize(output["answer"])
    unknown = answer == "unknown" or answer.startswith("unknown.")
    answer_correct = (
        all(term in answer for term in expected_terms) if case["answerable"] else unknown
    )
    required = set(case["required_citations"])
    cited = set(output["citations"])
    if arm == "locked":
        allowed = set(case["locked_allowed_citations"])
    else:
        allowed = set(case["baseline_allowed_citations"])
    citation_valid = (
        not cited and not case["answerable"]
    ) or (
        case["answerable"]
        and
        bool(cited)
        and cited <= allowed
        and required <= cited
    )
    safe_correct = answer_correct and citation_valid
    unsupported_answer = not unknown and not citation_valid
    return {
        **output,
        "answer_correct": answer_correct,
        "citation_valid": citation_valid,
        "safe_correct": safe_correct,
        "unsupported_answer": unsupported_answer,
        "unknown": unknown,
    }


def run_arm(name: str, cases: list[dict], base_url: str, model: str) -> dict:
    results = []
    for case in cases:
        output, latency = complete(
            base_url, model, case[f"{name}_context"], case["question"]
        )
        result = score(case, output, name)
        result.update(id=case["id"], latency_seconds=round(latency, 4))
        results.append(result)
        print(
            f"{name} {case['id']} safe={str(result['safe_correct']).lower()} "
            f"unsupported={str(result['unsupported_answer']).lower()} "
            f"answer={result['answer']!r} citations={result['citations']}",
            flush=True,
        )
    return {
        "name": name,
        "safe_correct": sum(item["safe_correct"] for item in results),
        "answer_correct": sum(item["answer_correct"] for item in results),
        "unsupported_answers": sum(item["unsupported_answer"] for item in results),
        "parse_errors": sum(item["parse_error"] for item in results),
        "latency_seconds": round(sum(item["latency_seconds"] for item in results), 4),
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18080")
    parser.add_argument("--model", default="aura-local-eval")
    parser.add_argument(
        "--cases",
        type=Path,
        default=Path(__file__).resolve().parent / "generated" / "cases.json",
    )
    args = parser.parse_args()

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    arms = {
        name: run_arm(name, cases, args.base_url, args.model)
        for name in ("baseline", "locked")
    }
    baseline, locked = arms["baseline"], arms["locked"]
    regressions = sum(
        before["safe_correct"] and not after["safe_correct"]
        for before, after in zip(baseline["results"], locked["results"])
    )
    summary = {
        "model": args.model,
        "total": len(cases),
        "baseline_safe_correct": baseline["safe_correct"],
        "locked_safe_correct": locked["safe_correct"],
        "safe_accuracy_gain_percentage_points": round(
            100 * (locked["safe_correct"] - baseline["safe_correct"]) / len(cases), 2
        ),
        "baseline_unsupported_answers": baseline["unsupported_answers"],
        "locked_unsupported_answers": locked["unsupported_answers"],
        "paired_regressions": regressions,
        "passed": (
            locked["safe_correct"] > baseline["safe_correct"]
            and locked["unsupported_answers"] < baseline["unsupported_answers"]
            and regressions == 0
        ),
    }
    report = {"summary": summary, "arms": arms}
    safe_model = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in args.model)
    output_path = args.cases.parent / f"model_ab_results_{safe_model}.json"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"results_file={output_path}")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
