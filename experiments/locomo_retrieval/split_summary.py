"""Summaries per LoCoMo split. Usage: split_summary.py <selection|heldout> label..."""
import json, sys
SPLITS = {"selection": set(range(0, 5)), "heldout": set(range(5, 10))}
split = SPLITS[sys.argv[1]]
for label in sys.argv[2:]:
    r = json.load(open(f"results_{label}.json", encoding="utf-8"))
    rows = [x for x in r["rows"] if x["conversation"] in split]
    out = {}
    for arm in ("vector_bge", "aura_plain", "aura_bge"):
        for cat in (1, 2):
            g = [x for x in rows if x["category"] == cat]
            out[f"{arm}/{cat}"] = (sum(x["all_gold_at_100"][arm] for x in g),
                                   sum(x["arms"][arm]["500"]["all_gold"] for x in g), len(g))
    print(label, r.get("fusion_mode"), json.dumps(out))
