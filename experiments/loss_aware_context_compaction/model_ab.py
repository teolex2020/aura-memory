#!/usr/bin/env python3
"""Run a deterministic local-LLM A/B against emitted experiment contexts."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path


SYSTEM = (
    "You are a strict memory QA evaluator. Answer using only the supplied CONTEXT. "
    "If the answer is absent, return exactly UNKNOWN. Otherwise return only the "
    "shortest exact answer copied from the context, with no explanation."
)


def normalize(value: str) -> str:
    return " ".join(value.lower().split())


def complete(base_url: str, model: str, context: str, question: str) -> tuple[str, float]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": f"CONTEXT:\n{context}\nQUESTION:\n{question}\nANSWER:",
            },
        ],
        "temperature": 0.0,
        "top_p": 1.0,
        "seed": 42,
        "max_tokens": 48,
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
    return body["choices"][0]["message"]["content"].strip(), latency


def load_questions(path: Path) -> list[dict[str, str]]:
    rows = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for line in lines[1:]:
        probe_id, question, expected = line.split("\t", 2)
        rows.append({"id": probe_id, "question": question, "expected": expected})
    return rows


def run_arm(
    name: str,
    context: str,
    questions: list[dict[str, str]],
    base_url: str,
    model: str,
) -> dict:
    results = []
    for probe in questions:
        answer, latency = complete(base_url, model, context, probe["question"])
        expected = normalize(probe["expected"])
        normalized_answer = normalize(answer)
        answerable = expected in normalize(context)
        correct = expected in normalized_answer
        unknown = normalized_answer == "unknown" or normalized_answer.startswith("unknown.")
        results.append(
            {
                **probe,
                "answer": answer,
                "answerable": answerable,
                "correct": correct,
                "unknown": unknown,
                "hallucinated_when_unanswerable": not answerable and not unknown,
                "latency_seconds": round(latency, 4),
            }
        )
        print(
            f"{name} {probe['id']} correct={str(correct).lower()} "
            f"answerable={str(answerable).lower()} answer={answer!r}",
            flush=True,
        )

    return {
        "name": name,
        "correct": sum(item["correct"] for item in results),
        "answerable": sum(item["answerable"] for item in results),
        "hallucinations": sum(item["hallucinated_when_unanswerable"] for item in results),
        "total": len(results),
        "latency_seconds": round(sum(item["latency_seconds"] for item in results), 4),
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18080")
    parser.add_argument("--model", default="aura-local-eval")
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=Path(__file__).resolve().parent / "generated",
    )
    args = parser.parse_args()

    questions = load_questions(args.fixtures / "qa.tsv")
    contexts = {
        "baseline": (args.fixtures / "context_baseline.txt").read_text(encoding="utf-8"),
        "compacted": (args.fixtures / "context_compacted.txt").read_text(encoding="utf-8"),
    }
    arms = {
        name: run_arm(name, context, questions, args.base_url, args.model)
        for name, context in contexts.items()
    }

    baseline = arms["baseline"]
    compacted = arms["compacted"]
    regressions = sum(
        before["correct"] and not after["correct"]
        for before, after in zip(baseline["results"], compacted["results"])
    )
    gains = sum(
        not before["correct"] and after["correct"]
        for before, after in zip(baseline["results"], compacted["results"])
    )
    summary = {
        "model": args.model,
        "baseline_correct": baseline["correct"],
        "compacted_correct": compacted["correct"],
        "total": baseline["total"],
        "accuracy_gain_percentage_points": round(
            100.0 * (compacted["correct"] - baseline["correct"]) / baseline["total"], 2
        ),
        "paired_gains": gains,
        "paired_regressions": regressions,
        "baseline_hallucinations": baseline["hallucinations"],
        "compacted_hallucinations": compacted["hallucinations"],
        "passed": (
            100.0 * (compacted["correct"] - baseline["correct"]) / baseline["total"]
            >= 20.0
            and regressions == 0
        ),
    }
    report = {"summary": summary, "arms": arms}
    safe_model = "".join(
        character if character.isalnum() or character in "-_" else "_"
        for character in args.model
    )
    output = args.fixtures / f"model_ab_results_{safe_model}.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"results_file={output}")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
