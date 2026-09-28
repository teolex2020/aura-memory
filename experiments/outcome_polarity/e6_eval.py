"""E6: embedding-based belief clustering across languages. See PROTOCOL_E6.md."""

from __future__ import annotations

import json
import math
import sys
import tempfile
import urllib.request
from pathlib import Path

from aura import Aura, Level

MODEL = "bge-m3"

CALIBRATION_SAME = [
    ("The build server ran out of disk space overnight", "Overnight the CI machine's disk filled up"),
    ("The build server ran out of disk space overnight", "Вночі на сервері збірки закінчилося місце на диску"),
    ("Вночі на сервері збірки закінчилося місце на диску", "За ніч диск CI-машини повністю заповнився"),
    ("The build server ran out of disk space overnight", "Über Nacht war die Festplatte des Build-Servers voll"),
    ("Customers could not log in after the update", "Після оновлення клієнти не могли увійти"),
    ("Customers could not log in after the update", "Users were locked out of their accounts following the update"),
]
CALIBRATION_DIFFERENT = [
    ("The build server ran out of disk space overnight", "The build server was upgraded to a faster CPU"),
    ("Customers could not log in after the update", "Customers praised the new login page after the update"),
    ("Вночі на сервері збірки закінчилося місце на диску", "Команда переїхала в новий офіс"),
    ("Customers could not log in after the update", "The quarterly budget was approved"),
    ("Über Nacht war die Festplatte des Build-Servers voll", "Der Build-Server bekam eine schnellere CPU"),
]

CASES = [
    ("en", "negative",
     ["Deployed straight to production without staging on Friday", "Pushed the release to production skipping staging at night"],
     ["Checkout stopped working for customers after that release", "Payments went down for two hours after the release"]),
    ("uk", "negative",
     ["Задеплоїли прямо в продакшн без стейджингу в п'ятницю", "Випустили реліз у продакшн уночі, оминувши стейджинг"],
     ["Після того релізу оформлення замовлень перестало працювати", "Платежі лежали дві години після релізу"]),
    ("de", "negative",
     ["Am Freitag direkt ohne Staging in die Produktion ausgerollt", "Das Release nachts ohne Staging in die Produktion gebracht"],
     ["Nach dem Release funktionierte der Checkout nicht mehr", "Die Zahlungen waren nach dem Release zwei Stunden ausgefallen"]),
    ("en", "positive",
     ["Deployed to staging first and ran the smoke suite", "Rolled out through staging with the health gate on"],
     ["Customers noticed quicker page loads after that release", "The release went live and orders kept flowing smoothly"]),
    ("uk", "positive",
     ["Спершу задеплоїли на стейджинг і прогнали смоук-тести", "Викотили через стейджинг з увімкненим health gate"],
     ["Після релізу сторінки почали вантажитися помітно швидше", "Реліз вийшов, і замовлення йшли без перебоїв"]),
    ("de", "positive",
     ["Zuerst auf Staging ausgerollt und die Smoke-Tests laufen lassen", "Über Staging mit aktiviertem Health Gate ausgerollt"],
     ["Nach dem Release luden die Seiten spürbar schneller", "Das Release ging live und Bestellungen liefen reibungslos"]),
    ("en+uk", "negative",
     ["Deployed straight to production without staging on Friday", "Випустили реліз у продакшн уночі, оминувши стейджинг"],
     ["Checkout stopped working for customers after that release", "Платежі лежали дві години після релізу"]),
]

DISTRACTORS = [
    "The team moved to a new office on the third floor",
    "A new coffee machine arrived in the kitchen",
]

_cache: dict[str, list[float]] = {}


def embed(text: str) -> list[float]:
    if text not in _cache:
        body = json.dumps({"model": MODEL, "input": text}).encode()
        request = urllib.request.Request(
            "http://127.0.0.1:11434/api/embed", data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            _cache[text] = json.loads(response.read())["embeddings"][0]
    return _cache[text]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def calibrate() -> dict:
    same = [cosine(embed(a), embed(b)) for a, b in CALIBRATION_SAME]
    diff = [cosine(embed(a), embed(b)) for a, b in CALIBRATION_DIFFERENT]
    low_same, high_diff = min(same), max(diff)
    separable = low_same > high_diff
    return {
        "same": [round(v, 3) for v in same],
        "different": [round(v, 3) for v in diff],
        "separable": separable,
        "threshold": round((low_same + high_diff) / 2, 3) if separable else None,
    }


def run_case(lang, outcome, causes, effects, threshold):
    with tempfile.TemporaryDirectory() as directory:
        brain = Aura(directory)
        brain.set_embedding_fn(embed)
        brain.set_embedding_claim_threshold(threshold)
        ids, effect_ids = [], []
        for cause, effect in zip(causes, effects):
            c = brain.store(cause, level=Level.Domain, tags=["deploy"], source_type="recorded",
                            deduplicate=False, namespace="e6")
            e = brain.store(effect, level=Level.Domain, tags=["result"], source_type="recorded",
                            metadata={"outcome": outcome}, deduplicate=False,
                            caused_by_id=c, namespace="e6")
            ids += [c, e]
            effect_ids.append(e)
        distractor_ids = [
            brain.store(text, level=Level.Domain, tags=["result"], source_type="recorded",
                        deduplicate=False, namespace="e6")
            for text in DISTRACTORS
        ]
        for i in range(6):
            brain.store(f"Filler note {i} about parking and lunch {i}", level=Level.Domain,
                        tags=[f"misc{i}"], deduplicate=False, namespace="e6")
        brain.run_maintenance()
        brain.run_maintenance()
        actions = [h.action_kind for h in brain.get_surfaced_policy_hints()
                   if all(r in ids for r in h.supporting_record_ids)]
        effect_beliefs = {brain.get_belief_id_for_record(e) for e in effect_ids} - {None}
        false_joins = sum(brain.get_belief_id_for_record(d) in effect_beliefs for d in distractor_ids)
        brain.close()
    expected = ("avoid", "verify") if outcome == "negative" else ("prefer", "recommend")
    return {
        "lang": lang, "outcome": outcome, "actions": actions,
        "correct": bool(actions) and all(a in expected for a in actions),
        "effect_beliefs": len(effect_beliefs), "false_joins": false_joins,
    }


def main() -> None:
    calibration = calibrate()
    print("calibration:", calibration)
    out = Path(__file__).with_name("results_e6.json")
    if len(sys.argv) > 1 and sys.argv[1] == "--exploratory":
        # Not gated: the frozen calibration stopped the scored run. This uses
        # the pre-registered reference constant 0.80 to see what it would do.
        calibration = {**calibration, "separable": True, "threshold": 0.80,
                       "exploratory": True}
        out = Path(__file__).with_name("results_e6_exploratory.json")
    if not calibration["separable"]:
        out.write_text(json.dumps({"calibration": calibration, "stopped": True}, indent=2) + "\n")
        print("stopped: model cannot separate calibration pairs")
        return
    threshold = calibration["threshold"]
    rows = [run_case(*case, threshold) for case in CASES]
    by = lambda lang, outcome: next(r for r in rows if r["lang"] == lang and r["outcome"] == outcome)
    gates = {
        "P1_negative_parity": all(by(l, "negative")["correct"] for l in ("en", "uk", "de")),
        "P2_positive_parity": all(by(l, "positive")["correct"] for l in ("en", "uk", "de")),
        "P3_no_false_joins": all(r["false_joins"] == 0 for r in rows),
        "P4_cross_language": by("en+uk", "negative")["correct"],
    }
    out.write_text(json.dumps({"calibration": calibration, "cases": rows, "gates": gates},
                              indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for r in rows:
        print(f"{r['lang']:6} {r['outcome']:8} -> {r['actions']} beliefs={r['effect_beliefs']} false_joins={r['false_joins']}")
    print("gates:", gates)


if __name__ == "__main__":
    main()
