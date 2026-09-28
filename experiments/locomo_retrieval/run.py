"""E7: LoCoMo scoped retrieval for the AuraSDK build on the import path.

Adapted from D:/Aura-clean/experiments/memory_embedding_retest_2026_09_27/run.py.
The frozen harness functions (corpus loading, BGE encoding, scoring) are
imported read-only from the Aura-clean experiment so the numbers stay
comparable with its recorded 1.60 baseline.

Usage: python run.py <label>   -> results_<label>.json
"""

from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

HERE = Path(__file__).resolve().parent
FROZEN = Path("D:/Aura-clean/experiments/memory_failure_map_2026_09_25")
sys.path.insert(0, str(FROZEN))

import aura  # noqa: E402
from aura import Aura, Level, __version__ as aura_version  # noqa: E402
from run import (  # noqa: E402
    BGE, BUDGETS, DATASET, DOC_VECTORS, QWEN_TOKENIZER, QUERY_INSTRUCTION,
    TOP_N, encode_texts, load_corpus, score, sha256,
)
from run_scoped import CONTENT_RE, group_indices  # noqa: E402

LABEL = sys.argv[1] if len(sys.argv) > 1 else "run"
SCRATCH = Path(
    "C:/Users/<user>/AppData/Local/Temp/claude/D--AuraSDK-public/"
    "ff9c9143-c67a-4bee-b804-cdba1e549dfd/scratchpad/locomo_indexes"
)
INDEXES = SCRATCH / LABEL
RESULT = HERE / f"results_{LABEL}.json"
ARMS = ("vector_bge", "aura_plain", "aura_bge")


def aura_ranking(brain, question, ci, ids, permitted):
    hits = brain.recall_structured(question["question"], top_k=TOP_N)
    ranking, seen = [], set()
    for hit in hits:
        match = CONTENT_RE.match(str(hit.get("content") or ""))
        if not match or int(match.group(1)) != ci:
            raise AssertionError((question["id"], "Aura scope leak"))
        index = ids.get(f"C{ci}|{match.group(2)}")
        if index is None or index not in permitted:
            raise AssertionError((question["id"], "Unknown Aura hit"))
        if index not in seen:
            ranking.append(index)
            seen.add(index)
    return ranking


def main():
    started = time.perf_counter()
    torch.set_num_threads(6)
    records, ids, questions, _ = load_corpus()
    groups = group_indices(records)
    vectors = np.load(DOC_VECTORS)
    if vectors.shape[0] != len(records):
        raise RuntimeError("Frozen document-vector count mismatch")
    qwen = AutoTokenizer.from_pretrained(QWEN_TOKENIZER, local_files_only=True)
    lengths = [len(qwen(c, add_special_tokens=False).input_ids) for c in records]
    bge_tok = AutoTokenizer.from_pretrained(BGE, local_files_only=True)
    bge = AutoModel.from_pretrained(BGE, local_files_only=True).eval()

    doc_map = {content: vectors[i].tolist() for i, content in enumerate(records)}
    counters = {"doc_hits": 0, "query_encodes": 0}
    query_cache: dict[str, list[float]] = {}

    def embed(text):
        vec = doc_map.get(text)
        if vec is not None:
            counters["doc_hits"] += 1
            return vec
        counters["query_encodes"] += 1
        if text not in query_cache:
            query_cache[text] = encode_texts(
                bge, bge_tok, [QUERY_INSTRUCTION + text], batch_size=1, max_length=128
            )[0].tolist()
        return query_cache[text]

    if INDEXES.exists():
        shutil.rmtree(INDEXES)
    INDEXES.mkdir(parents=True)
    brains = {"aura_plain": {}, "aura_bge": {}}
    write_seconds = {"aura_plain": 0.0, "aura_bge": 0.0}
    for ci, indices in groups.items():
        for arm in ("aura_plain", "aura_bge"):
            t0 = time.perf_counter()
            brain = Aura(str(INDEXES / f"{arm}_c{ci}"))
            if arm == "aura_bge":
                brain.set_embedding_fn(embed)
            for i in indices:
                brain.store(records[i], level=Level.Working, deduplicate=False)
            write_seconds[arm] += time.perf_counter() - t0
            brains[arm][ci] = brain
        print(json.dumps({"phase": "indexed", "conversation": ci,
                          "records": len(indices), **counters}), flush=True)
    if counters["query_encodes"]:
        raise RuntimeError(f"{counters['query_encodes']} stored texts missed the frozen vector map")

    local_arrays = {ci: np.asarray(ix, dtype=np.int64) for ci, ix in groups.items()}
    ids_by_index = [None] * len(records)
    for key, index in ids.items():
        ids_by_index[index] = key
    rows = []
    search_ms = {"aura_plain": [], "aura_bge": []}
    try:
        for n, question in enumerate(questions, 1):
            ci = question["conversation"]
            permitted = set(groups[ci])
            qv = encode_texts(bge, bge_tok, [QUERY_INSTRUCTION + question["question"]],
                              batch_size=1, max_length=128)[0]
            local = local_arrays[ci]
            sims = np.asarray(vectors[local] @ qv)
            order = np.argsort(-sims, kind="stable")[:TOP_N]
            rankings = {"vector_bge": [int(local[j]) for j in order]}
            for arm in ("aura_plain", "aura_bge"):
                t0 = time.perf_counter()
                rankings[arm] = aura_ranking(brains[arm][ci], question, ci, ids, permitted)
                search_ms[arm].append((time.perf_counter() - t0) * 1000)
            gold = set(question["gold_indices"])
            rows.append({
                "id": question["id"],
                "category": question["category"],
                "conversation": ci,
                "all_gold_at_100": {a: gold <= set(r[:TOP_N]) for a, r in rankings.items()},
                "ranked_counts": {a: len(r) for a, r in rankings.items()},
                "rankings": {a: r for a, r in rankings.items() if a != "vector_bge"},
                "arms": {a: {b: {k: v for k, v in m.items() if k != "selected_ids"}
                             for b, m in score(question, r, lengths, ids_by_index).items()}
                         for a, r in rankings.items()},
            })
            if n % 100 == 0:
                print(json.dumps({"phase": "scored", "questions": n}), flush=True)
    finally:
        for per_arm in brains.values():
            for brain in per_arm.values():
                brain.close()

    summary = {}
    for arm in ARMS:
        summary[arm] = {}
        for cat in (1, 2):
            group = [r for r in rows if r["category"] == cat]
            entry = {"questions": len(group),
                     "all_gold_at_100": sum(r["all_gold_at_100"][arm] for r in group)}
            for budget in BUDGETS:
                entry[f"all_gold_at_{budget}_tokens"] = sum(
                    r["arms"][arm][str(budget)]["all_gold"] for r in group)
            summary[arm][str(cat)] = entry
    median = lambda xs: round(float(np.median(xs)), 2)
    result = {
        "protocol": "PROTOCOL.md",
        "label": LABEL,
        "aura_version": aura_version,
        "aura_module": aura.__file__,
        "script_sha256": sha256(Path(__file__)),
        "dataset_sha256": sha256(DATASET),
        "records": len(records),
        "questions": len(rows),
        "embedding_fn_calls": counters,
        "write_seconds": {k: round(v, 2) for k, v in write_seconds.items()},
        "search_ms_median": {k: median(v) for k, v in search_ms.items()},
        "summary": summary,
        "total_seconds": round(time.perf_counter() - started, 2),
        "rows": rows,
    }
    RESULT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"phase": "done", "label": LABEL, "summary": summary,
                      "write_seconds": result["write_seconds"],
                      "search_ms_median": result["search_ms_median"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
