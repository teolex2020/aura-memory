"""Ablation (reported only): R1 without the time-contradicts-user rule."""

import rule_r1


def decide(proposal, request, memory):
    verdict = rule_r1.decide(proposal, request, memory)
    tainted = {k: v for k, v in verdict["tainted"].items() if v != "time_contradicts_user"}
    return {"decision": "confirm" if tainted else "allow", "tainted": tainted}
