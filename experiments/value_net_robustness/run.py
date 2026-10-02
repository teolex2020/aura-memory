"""E39: does E38's value net hold across splits and seeds? See PROTOCOL.md.

Run with the D:\\Aura-clean\\.venv interpreter (numpy) as a tool; reuses E38's
labeling, network, test stream and E37's API cache and rows.
    python run.py label    -> labels_extra.jsonl (the 5 conversations E38 did not label)
    python run.py test     -> rows.jsonl
    python run.py analyze  -> results.json
"""

from __future__ import annotations

import importlib.util
import json
import random
import statistics
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SPLIT_SEEDS = (38, 39, 40, 41, 42, 43)

_spec = importlib.util.spec_from_file_location("e38", HERE.parent / "value_net" / "run.py")
e38 = importlib.util.module_from_spec(_spec)
sys.modules["e38"] = e38
_spec.loader.exec_module(e38)
e37 = e38.e37


def ids() -> list[str]:
    return sorted(c["sample_id"] for c in e37.load())


def splits() -> dict[int, dict]:
    out = {}
    for seed in SPLIT_SEEDS:
        train = sorted(random.Random(seed).sample(ids(), 5))
        out[seed] = {"train": train, "test": [i for i in ids() if i not in train]}
    assert out[38] == e38.the_split(), "S0 must be E38's split"
    return out


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").split("\n") if l.strip()] if path.exists() else []


def labels() -> dict[tuple[str, str], dict]:
    rows = read_jsonl(HERE.parent / "value_net" / "labels.jsonl") + read_jsonl(HERE / "labels_extra.jsonl")
    return {(r["conv"], r["id"]): r for r in rows}


def label() -> None:
    have = {c for c, _ in labels()}
    convs = {c["sample_id"]: c for c in e37.load()}
    lock = threading.Lock()

    def one(cid):
        rows = e38.label_conv(convs[cid])
        with lock, (HERE / "labels_extra.jsonl").open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"conv": cid, "records": len(rows), "consequence": sum(r["consequence"] for r in rows),
                          "usd": round(e37.spent(), 3)}), flush=True)

    with ThreadPoolExecutor(5) as pool:
        list(pool.map(one, [c for c in ids() if c not in have]))


def train_model(train_ids: list[str], seed: int, structural_only: bool) -> dict:
    lab = labels()
    x, keys = e38.matrix(train_ids)
    if structural_only:
        x = x[:, -4:]
    y = np.asarray([float(lab[k]["consequence"]) for k in keys], np.float32)
    e38.SEED = seed  # e38.fit reads its module seed
    return e38.fit(x, y)


def values_for(model: dict, test_ids: list[str], structural_only: bool) -> dict[str, dict[str, float]]:
    x, keys = e38.matrix(test_ids)
    if structural_only:
        x = x[:, -4:]
    out: dict[str, dict[str, float]] = {cid: {} for cid in test_ids}
    for (cid, d), v in zip(keys, e38.predict(model, x)):
        out[cid][d] = float(v)
    return out


def test() -> None:
    data = {c["sample_id"]: c for c in e37.load()}
    convs = {cid: e37.build(data[cid]) for cid in ids()}
    raws = {cid: e38.raw_turns(data[cid]) for cid in ids()}
    out = HERE / "rows.jsonl"
    done = {(r["split"], r["conv"], r["arm"]) for r in read_jsonl(out)}
    e38_l = {r["conv"] for r in read_jsonl(HERE.parent / "value_net" / "rows.jsonl") if r["arm"] == "L"}
    jobs = []
    # L once per conversation where E38 did not run it.
    for cid in ids():
        if cid not in e38_l and ("any", cid, "L") not in done:
            jobs.append(("any", cid, "L", {}))
    for seed, sp in splits().items():
        arms = {f"V{seed}": (seed, False), f"V{seed + 100}": (seed + 100, False), "S": (seed, True)}
        for arm, (train_seed, structural) in arms.items():
            if all((seed, cid, arm) in done for cid in sp["test"]):
                continue
            model = train_model(sp["train"], train_seed, structural)
            vals = values_for(model, sp["test"], structural)
            for cid in sp["test"]:
                if (seed, cid, arm) not in done:
                    jobs.append((seed, cid, arm, vals[cid]))
    lock = threading.Lock()

    def one(job):
        split, cid, arm, vals = job
        rows = e38.run_test_conv(convs[cid], raws[cid], "L" if arm == "L" else "V", vals)
        for r in rows:
            r["split"], r["arm"] = split, arm
        with lock, out.open("a", encoding="utf-8") as f:
            f.write("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"split": split, "conv": cid, "arm": arm,
                          "acc": round(100 * sum(r["correct"] for r in rows) / len(rows), 1),
                          "usd": round(e37.spent(), 3)}), flush=True)

    print(json.dumps({"jobs": len(jobs)}), flush=True)
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(one, jobs))


def analyze() -> None:
    e37_rows = read_jsonl(HERE.parent / "outcome_memory" / "rows.jsonl")
    e38_rows = read_jsonl(HERE.parent / "value_net" / "rows.jsonl")
    mine = read_jsonl(HERE / "rows.jsonl")

    def acc(rows, convs):
        xs = [r["correct"] for r in rows if r["conv"] in convs]
        return 100 * sum(xs) / len(xs) if xs else None

    per_split = {}
    for seed, sp in splits().items():
        test = set(sp["test"])
        a = {arm: acc([r for r in e37_rows if r["arm"] == arm], test) for arm in ("U", "R", "D")}
        a["L"] = acc([r for r in e38_rows + mine if r["arm"] == "L"], test)
        v_seeds = [acc([r for r in mine if r["split"] == seed and r["arm"] == f"V{s}"], test) for s in (seed, seed + 100)]
        if seed == 38:  # E38's own run is the first seed of S0
            v_seeds[0] = acc([r for r in e38_rows if r["arm"] == "V"], test) if v_seeds[0] is None else v_seeds[0]
        a["V_seeds"] = [round(v, 1) for v in v_seeds if v is not None]
        a["V"] = statistics.mean(a["V_seeds"]) if a["V_seeds"] else None
        a["S"] = acc([r for r in mine if r["split"] == seed and r["arm"] == "S"], test)
        per_split[seed] = {k: (round(v, 1) if isinstance(v, float) else v) for k, v in a.items()}

    def mean_diff(x, y):
        return round(statistics.mean(s[x] - s[y] for s in per_split.values()), 1)

    gates = {
        "R1": all(s["V"] > s["D"] for s in per_split.values()) and mean_diff("V", "D") >= 5,
        "R2": mean_diff("V", "L") >= 3 and sum(s["V"] > s["L"] for s in per_split.values()) >= 5,
        "R3": mean_diff("V", "S") >= 3,
    }
    result = {"gates": gates,
              "mean_diff": {"V-D": mean_diff("V", "D"), "V-R": mean_diff("V", "R"), "V-L": mean_diff("V", "L"),
                            "V-S": mean_diff("V", "S"), "L-D": mean_diff("L", "D"), "U-V": mean_diff("U", "V")},
              "V_beats": {"D": sum(s["V"] > s["D"] for s in per_split.values()),
                          "L": sum(s["V"] > s["L"] for s in per_split.values()),
                          "S": sum(s["V"] > s["S"] for s in per_split.values())},
              "per_split": per_split, "usd_total_shared_cache": round(e37.spent(), 3)}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"label": label, "test": test, "analyze": analyze}[sys.argv[1]]()
