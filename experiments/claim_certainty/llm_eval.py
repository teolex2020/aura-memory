"""E4: evaluate a local LLM as Aura's claim classifier. See PROTOCOL_E4.md.

Usage: python llm_eval.py <dataset.jsonl> [model ...]
Requires the `aura` package (for the rules arm) and a local Ollama server.
"""

from __future__ import annotations

import json
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

LABELS = ("asserted", "hedged", "speculative", "hearsay")

PROMPT = """Classify what kind of claim the sentence makes. Answer with exactly one word.

asserted: the speaker states something first-hand about themselves, their life, work or the world, without hedging. Reports of the speaker's OWN speech or actions are asserted.
hearsay: the speaker relays a claim that came from someone else or from other sources (a person, doctor, colleague, news, website, article, manual, documentation, rumors, "people"), regardless of how reliable the source is.
hedged: first-hand but qualified; the speaker leans toward believing it but signals they are not fully certain.
speculative: explicitly uncertain, hypothetical, guessing, wondering, or asking whether something is the case.

The sentence may be in Ukrainian or English.

Sentence: {text}
Answer (asserted, hearsay, hedged or speculative):"""


def ask(model: str, text: str) -> str | None:
    body = json.dumps({
        "model": model,
        "prompt": PROMPT.format(text=text),
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 8},
    }).encode()
    request = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        answer = json.loads(response.read())["response"].strip().lower()
    for label in LABELS:
        if answer.startswith(label) or label in answer.split():
            return label
    return None


def rules(text: str) -> str:
    import tempfile
    from aura import Aura

    global _brain
    if "_brain" not in globals():
        _dir = tempfile.mkdtemp()
        _brain = Aura(_dir)
        _brain.set_claim_rules_enabled(True)
    rid = _brain.store(text, deduplicate=False)
    return _brain.get(rid).metadata.get("claim_certainty", "asserted")


def score(rows, predictions):
    confusion = defaultdict(lambda: defaultdict(int))
    for (text, label), predicted in zip(rows, predictions):
        confusion[label][predicted] += 1
    count = lambda l, p: confusion[l][p]
    hearsay_total = sum(confusion["hearsay"].values())
    predicted_hearsay = sum(m["hearsay"] for m in confusion.values())
    recall = count("hearsay", "hearsay") / max(hearsay_total, 1)
    precision = count("hearsay", "hearsay") / max(predicted_hearsay, 1)
    demoted = count("asserted", "hearsay") + count("asserted", "speculative")
    accuracy = sum(count(l, l) for l in LABELS) / max(len(rows), 1)
    asserted_total = sum(confusion["asserted"].values())
    return {
        "hearsay_recall": round(recall, 3),
        "hearsay_precision": round(precision, 3),
        "asserted_demoted": demoted,
        "accuracy": round(accuracy, 3),
        "confusion": {l: dict(confusion[l]) for l in LABELS},
        "gates": {
            "H1": recall >= 0.80,
            "H2": demoted <= max(1, round(asserted_total * 0.05)),
            "H3": precision >= 0.85,
            "H4": accuracy >= 0.70,
        },
    }


def main() -> None:
    dataset = Path(sys.argv[1])
    models = sys.argv[2:] or ["qwen3:4b-instruct", "gemma3n:e4b"]
    rows = [(json.loads(l)["text"], json.loads(l)["label"])
            for l in dataset.read_text(encoding="utf-8").splitlines() if l.strip()]
    results = {"dataset": dataset.name, "n": len(rows), "arms": {}}

    rule_predictions = [rules(text) for text, _ in rows]
    results["arms"]["rules"] = score(rows, rule_predictions)

    for model in models:
        predictions, latencies, unparsed = [], [], 0
        for text, _ in rows:
            started = time.perf_counter()
            label = ask(model, text)
            latencies.append(time.perf_counter() - started)
            if label is None:
                unparsed += 1
            predictions.append(label)
        llm_only = [p or "asserted" for p in predictions]
        combined = [p or r for p, r in zip(predictions, rule_predictions)]
        timing = {
            "median_s": round(statistics.median(latencies), 3),
            "p95_s": round(sorted(latencies)[int(len(latencies) * 0.95) - 1], 3),
            "unparsed": unparsed,
        }
        results["arms"][f"llm:{model}"] = {**score(rows, llm_only), **timing}
        results["arms"][f"llm+rules:{model}"] = score(rows, combined)

    out = dataset.parent.parent / f"results_e4_{dataset.stem}.json"
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for arm, r in results["arms"].items():
        print(f"{arm:32} recall={r['hearsay_recall']:.2f} prec={r['hearsay_precision']:.2f} "
              f"demoted={r['asserted_demoted']} acc={r['accuracy']:.2f} gates={r['gates']}"
              + (f" median={r['median_s']}s p95={r['p95_s']}s unparsed={r['unparsed']}" if "median_s" in r else ""))


if __name__ == "__main__":
    main()
