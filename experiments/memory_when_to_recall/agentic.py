"""E57 Part A: model calls per user message in real agent runs (OpenHands, SWE-rebench). See PROTOCOL.md.

Run with E:\\remy\\app\\.venv (pyarrow). Reads only message roles and lengths; no text is kept.
    python agentic.py   -> results_agentic.json
"""

from __future__ import annotations

import json
import random
import statistics
from pathlib import Path

import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
DATA = Path(r"E:\aura-benchmarks\nebius__SWE-rebench-openhands-trajectories\trajectories.parquet")
SAMPLE = 2000


def text_len(content) -> int:
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        return sum(text_len(c.get("text", "") if isinstance(c, dict) else c) for c in content)
    return 0


def main() -> None:
    pf = pq.ParquetFile(DATA)
    total = pf.metadata.num_rows
    want = set(random.Random(57).sample(range(total), min(SAMPLE, total)))
    calls_per_user_msg, user_msgs, first_ctx_chars, final_ctx_chars = [], [], [], []
    row = 0
    for batch in pf.iter_batches(batch_size=256, columns=["trajectory"]):
        for traj in batch.column("trajectory").to_pylist():
            if row in want:
                msgs = json.loads(traj) if isinstance(traj, str) else traj
                users = sum(1 for m in msgs if m.get("role") == "user")
                calls = sum(1 for m in msgs if m.get("role") == "assistant")
                if users:
                    user_msgs.append(users)
                    calls_per_user_msg.append(calls / users)
                    # context the model re-reads at the first and last call (chars of everything before it)
                    sizes, running = [], 0
                    for m in msgs:
                        if m.get("role") == "assistant":
                            sizes.append(running)
                        running += text_len(m.get("content"))
                    if sizes:
                        first_ctx_chars.append(sizes[0])
                        final_ctx_chars.append(sizes[-1])
            row += 1

    def summary(xs):
        xs = sorted(xs)
        return {"n": len(xs), "median": round(statistics.median(xs), 1), "p90": round(xs[int(0.9 * (len(xs) - 1))], 1),
                "mean": round(statistics.mean(xs), 1)}

    res = {"trajectories": len(calls_per_user_msg), "user_messages_per_run": summary(user_msgs),
           "model_calls_per_user_message": summary(calls_per_user_msg),
           "context_chars_at_first_call": summary(first_ctx_chars),
           "context_chars_at_last_call": summary(final_ctx_chars)}
    (HERE / "results_agentic.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
