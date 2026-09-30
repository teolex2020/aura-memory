"""E29: does the core default recall reproduce the tested REL context?

Deterministic, no LLM. Run twice on separate copies of the same E29 stores:
    python core_check.py <store_root> <format|default> <out.json>
with the E28 test build (format provenance_rel) and with the core build
(format default); then compare the two JSON files.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

from aura import Aura

OLLAMA = "http://127.0.0.1:11434"


def embed(text: str) -> list[float]:
    body = json.dumps({"model": "bge-m3", "input": [text[:2000]]}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as response:
        return json.loads(response.read())["embeddings"][0]


def main(root: str, fmt: str, out: str) -> None:
    questions = json.loads(os.environ["E29_QUESTIONS"])
    contexts = {}
    for qid, text in questions.items():
        brain = Aura(str(Path(root) / qid))
        brain.set_embedding_fn(embed)
        contexts[qid] = brain.recall(text, format=None if fmt == "default" else fmt)
        brain.close()
    Path(out).write_text(json.dumps(contexts, ensure_ascii=False), encoding="utf-8")
    print(len(contexts), "contexts")


if __name__ == "__main__":
    main(*sys.argv[1:4])
