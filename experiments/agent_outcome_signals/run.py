"""E45: do agent-visible signals predict real success? See PROTOCOL.md.

Run with E:\\remy\\app\\.venv (pyarrow, numpy) as a tool:
    python run.py signals   -> signals.jsonl (one row per trajectory, no text)
    python run.py analyze   -> results.json
"""

from __future__ import annotations

import json
import math
import random
import re
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
DATA = Path(r"E:\aura-benchmarks\nebius__SWE-rebench-openhands-trajectories\trajectories.parquet")
EXIT = re.compile(r"\[The command completed with exit code (-?\d+)\.\]")
TEST = re.compile(r"pytest|py\.test|\btox\b|unittest|\bnose|npm test|yarn test|\bjest\b|go test|cargo test|"
                  r"mvn test|gradle test|\brspec\b")
SEED = 45


def command_of(call: dict) -> str:
    try:
        args = json.loads(call["function"]["arguments"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return ""
    return str(args.get("command", ""))


def signals_of(traj: list[dict]) -> dict:
    pending: dict[str, str] = {}
    commands = []  # (command line, exit code)
    turns = 0
    for m in traj:
        if m.get("role") == "assistant":
            turns += 1
            for call in m.get("tool_calls") or []:
                pending[call.get("id", "")] = command_of(call)
        elif m.get("role") == "tool":
            codes = EXIT.findall(str(m.get("content", "")))
            if codes:
                commands.append((pending.get(m.get("tool_call_id", ""), ""), int(codes[-1])))
    tests = [code for cmd, code in commands if TEST.search(cmd)]
    return {
        "fail_share": sum(c != 0 for _, c in commands) / len(commands) if commands else 0.0,
        "last_exit_ok": float(commands[-1][1] == 0) if commands else 0.5,
        "last_test_ok": float(tests[-1] == 0) if tests else 0.5,
        "steps": math.log1p(turns),
        "commands": len(commands),
    }


def signals() -> None:
    pf = pq.ParquetFile(DATA)
    out = (HERE / "signals.jsonl").open("w", encoding="utf-8")
    n = 0
    cols = ["trajectory_id", "repo", "trajectory", "exit_status", "resolved", "pred_passes_gen_tests"]
    for batch in pf.iter_batches(batch_size=500, columns=cols):
        for r in batch.to_pylist():
            s = signals_of(r["trajectory"])
            s.update({"id": r["trajectory_id"], "repo": r["repo"], "submitted": float(r["exit_status"] == "submit"),
                      "resolved": int(r["resolved"]), "pred_passes_gen_tests": r["pred_passes_gen_tests"]})
            out.write(json.dumps(s) + "\n")
            n += 1
        print(json.dumps({"parsed": n}), flush=True)
    out.close()


def auc(scores, labels) -> float:
    order = np.argsort(scores, kind="mergesort")
    s, y = np.asarray(scores)[order], np.asarray(labels)[order]
    ranks = np.empty(len(s))
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        ranks[i:j + 1] = (i + j) / 2 + 1
        i = j + 1
    pos = y.sum()
    neg = len(y) - pos
    return round(float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg)), 3)


def logit_cv(x, y, groups) -> float:
    uniq = sorted(set(groups))
    random.Random(SEED).shuffle(uniq)
    fold_of = {g: k % 5 for k, g in enumerate(uniq)}
    folds = np.asarray([fold_of[g] for g in groups])
    pred = np.zeros(len(y))
    for k in range(5):
        tr, te = folds != k, folds == k
        mu, sd = x[tr].mean(0), x[tr].std(0) + 1e-9
        z = (x - mu) / sd
        w, b = np.zeros(z.shape[1]), 0.0
        for _ in range(500):
            p = 1 / (1 + np.exp(-(z[tr] @ w + b)))
            g = p - y[tr]
            w -= 0.5 * (z[tr].T @ g / tr.sum() + 1e-3 * w)
            b -= 0.5 * g.mean()
        pred[te] = z[te] @ w + b
    return auc(pred, y)


def analyze() -> None:
    rows = [json.loads(l) for l in (HERE / "signals.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    y = np.asarray([r["resolved"] for r in rows], float)
    keys = ["fail_share", "last_exit_ok", "last_test_ok", "steps", "submitted"]
    x = np.asarray([[r[k] for k in keys] for r in rows], float)
    single = {k: auc(x[:, i] * (-1 if k in ("fail_share", "steps") else 1), y) for i, k in enumerate(keys)}
    ref = [r["pred_passes_gen_tests"] for r in rows]
    have_ref = [i for i, v in enumerate(ref) if v is not None]
    single["R_pred_passes_gen_tests"] = auc(np.asarray([ref[i] for i in have_ref], float), y[have_ref])
    cv = logit_cv(x, y, [r["repo"] for r in rows])
    base = float(y.mean())
    sel = [r for r in rows if r["last_test_ok"] == 1 and r["submitted"] == 1]
    prec = sum(r["resolved"] for r in sel) / len(sel) if sel else 0.0
    result = {"trajectories": len(rows), "base_rate_resolved": round(base, 3),
              "auc_single_signal": single, "cv_auc_S1_S5": cv,
              "precision_tests_ok_and_submitted": round(prec, 3), "share_tests_ok_and_submitted": round(len(sel) / len(rows), 3),
              "no_test_command_share": round(sum(r["last_test_ok"] == 0.5 for r in rows) / len(rows), 3),
              "gates": {"O1": cv >= 0.70, "O2": prec >= base + 0.20}}
    (HERE / "results.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    {"signals": signals, "analyze": analyze}[sys.argv[1]]()
