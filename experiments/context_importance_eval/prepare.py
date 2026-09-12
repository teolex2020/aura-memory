"""Read-only source qualification and chronological, opaque event export."""
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ("helpdesk", Path("D:/Aura-clean/artifacts/real_data/helpdesk_process_logs/helpdesk.csv"),
     "1306e06414481a1debd845ea760b5ce8331d087ddc67d7f7ec300b4bea3f41b7"),
    ("incident", Path("D:/Aura-clean/artifacts/real_data/helpdesk_process_logs/uci_incident_management/incident_event_log.csv"),
     "fd184bbfd62329cfe093e99da2ea7071905f2ead91900b448eb2635870821bef"),
]

def opaque(*parts):
    # Zero is reserved for global rules. Hashes are identifiers, not features.
    value = int.from_bytes(hashlib.sha256(json.dumps(parts).encode()).digest()[:8], "little")
    return value or 1

def convert(name, path, expected):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise ValueError(f"Source hash mismatch: {name}")
    raw = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for position, row in enumerate(csv.DictReader(handle)):
            if name == "helpdesk":
                case, state = row["CaseID"], row["ActivityID"]
                stamp = datetime.strptime(row["CompleteTimestamp"], "%Y-%m-%d %H:%M:%S")
                context = opaque(name)
            else:
                case, state = row["number"], row["incident_state"]
                value = row["sys_updated_at"]
                stamp = datetime.strptime(row["opened_at"] if value == "?" else value, "%d/%m/%Y %H:%M")
                context = opaque(name, row["category"], row["assignment_group"])
            raw.append((stamp, position, opaque(name, case), opaque(name, state), context))
    raw.sort()
    previous = {}
    events = []
    for stamp, position, case, state, context in raw:
        # Context changes remain visible even if the state itself is unchanged.
        if previous.get(case) == (state, context):
            continue
        previous[case] = (state, context)
        events.append({"case": case, "state": state, "context": context,
                       "time": stamp.isoformat(), "source_position": position})
    metadata = {"name": name, "path": str(path), "sha256": digest,
                "raw_rows": len(raw), "events": len(events), "cases": len(previous),
                "contexts": len({e['context'] for e in events}),
                "first_time": events[0]["time"], "last_time": events[-1]["time"],
                "train_end": len(events)*60//100, "validation_end": len(events)*80//100}
    return {"name": name, "events": events}, metadata

def qualify_working_memory():
    directory = Path("D:/Aura-clean/brain/working_memory")
    kinds = Counter()
    files = []
    for path in sorted(directory.glob("*.jsonl")):
        payload = path.read_bytes()
        rows = [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]
        kinds.update(row.get("kind", "unknown") for row in rows)
        files.append({"file": path.name, "sha256": hashlib.sha256(payload).hexdigest(), "rows": len(rows)})
    return {"directory": str(directory), "files": files, "kinds": dict(kinds),
            "eligible_for_memory_task_utility_replay": False,
            "reason": "Inspected records lack a sufficient joined stream of memory-use decisions and delayed task-utility outcomes; checkpoint receipts are not such labels."}

def main():
    datasets, sources = [], []
    for args in SOURCES:
        dataset, source = convert(*args)
        datasets.append(dataset)
        sources.append(source)
    encoded = json.dumps(datasets, separators=(",", ":")).encode()
    (ROOT/"events.local.json").write_bytes(encoded)
    manifest = {"schema": "context-importance-source-v1", "sources": sources,
                "export_sha256": hashlib.sha256(encoded).hexdigest(),
                "host_trace_qualification": qualify_working_memory()}
    (ROOT/"source_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"sources": sources, "host_trace_kinds": manifest["host_trace_qualification"]["kinds"]}, indent=2))

if __name__ == "__main__":
    main()
