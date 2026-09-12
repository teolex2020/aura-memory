import tempfile

from aura import Aura, Level


with tempfile.TemporaryDirectory() as directory:
    brain = Aura(directory)
    record_id = brain.store(
        "The current launch date is September 24.",
        level=Level.Domain,
        namespace="python-citation-lock",
        semantic_type="fact",
        deduplicate=False,
    )

    intent = brain.suggest_memory_intent("What is the current launch date?")
    assert intent["needs_memory"] is True
    assert intent["suggested_routes"] == ["timeline"]

    episode = brain.start_retrieval_episode(
        "What is the current launch date?", [record_id], routes=["timeline"]
    )
    source = b"The current launch date is September 24."
    opened = episode.open_verified_evidence(
        record_id=record_id,
        claim_id="claim-launch-date",
        claim_text="The current launch date is September 24.",
        route="timeline",
        support_keys=["launch-date"],
        document_id="launch-plan",
        revision_id="rev-2",
        uri="memory://launch-plan",
        registered_source_bytes=source,
        current_source_bytes=source,
        byte_start=0,
        byte_end=len(source),
        verification_status="verified",
        answer_permission="cite",
    )
    assert opened["citable"] is True
    assert opened["integrity_valid"] is True

    report = episode.finalize(
        answer_present=True,
        citations=[record_id],
        atomic_claim_keys=["launch-date"],
    )
    assert report["decision"] == "allow"
    assert report["answer_permitted"] is True

    partial = episode.finalize(
        answer_present=True,
        citations=[record_id],
        atomic_claim_keys=["launch-date", "launch-owner"],
    )
    assert partial["decision"] == "block"
    assert partial["unsupported_claim_keys"] == ["launch-owner"]

    brain.close()
    del brain

print("python_retrieval_episode_smoke=ok")
