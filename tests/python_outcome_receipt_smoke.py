import tempfile

from aura import Aura


with tempfile.TemporaryDirectory() as directory:
    brain = Aura(directory)
    runbook_id = brain.store(
        "Rollback the canary after the health gate fails.",
        namespace="python-outcome",
        semantic_type="fact",
        deduplicate=False,
    )
    incident_id = brain.store(
        "Verify recovery before resuming deployment.",
        namespace="python-outcome",
        semantic_type="fact",
        deduplicate=False,
    )

    kwargs = dict(
        task_id="deploy-184",
        lineage_id="canary-rollout",
        attempt_id="attempt-1",
        candidate_record_ids=[runbook_id, incident_id],
        selected_record_ids=[runbook_id],
        outcome="helpful",
        namespace="python-outcome",
        provenance=["host:python-smoke"],
        logging_policy_id="policy:python-smoke-v1",
        selected_set_probability_bps=2500,
        candidate_verdicts={
            runbook_id: "helpful",
            incident_id: "unhelpful",
        },
        verifier_id="verifier:python-smoke-v1",
    )
    receipt = brain.capture_outcome_receipt(**kwargs)
    duplicate = brain.capture_outcome_receipt(**kwargs)
    assert duplicate["receipt_id"] == receipt["receipt_id"]
    assert receipt["outcome"] == "helpful"
    assert receipt["schema_version"] == 2
    assert receipt["logging_policy_id"] == "policy:python-smoke-v1"
    assert receipt["selected_set_probability_bps"] == 2500
    assert {
        item["record_id"]: item["outcome"]
        for item in receipt["candidate_verdicts"]
    } == {runbook_id: "helpful", incident_id: "unhelpful"}
    assert receipt["verifier_id"] == "verifier:python-smoke-v1"
    assert receipt["candidate_record_ids"] == [runbook_id, incident_id]
    assert len(receipt["integrity_digest"]) == 64
    assert len(brain.outcome_receipts(namespace="python-outcome")) == 1

    conflicting = dict(kwargs)
    conflicting["outcome"] = "unhelpful"
    try:
        brain.capture_outcome_receipt(**conflicting)
    except RuntimeError:
        pass
    else:
        raise AssertionError("conflicting receipt retry must fail")

    brain.close()
    del brain

    reopened = Aura(directory)
    assert len(
        reopened.outcome_receipts(
            namespace="python-outcome", lineage_id="canary-rollout"
        )
    ) == 1
    purge = reopened.purge_record(runbook_id, "history")
    assert purge["audit_entries_removed"] >= 1
    assert reopened.outcome_receipts(namespace="python-outcome") == []
    assert reopened.get(incident_id) is not None
    reopened.close()
    del reopened

print("python_outcome_receipt_smoke=ok")
