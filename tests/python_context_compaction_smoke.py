import tempfile

from aura import Aura, Level


with tempfile.TemporaryDirectory() as directory:
    brain = Aura(directory)
    goal_text = (
        "Active goal GOAL-31. Prepare release 1.59.0 after all tests pass. "
        "Prepare release 1.59.0 after all tests pass."
    )
    goal_id = brain.store(
        goal_text,
        level=Level.Working,
        tags=["goal", "release"],
        content_type="text/plain",
        namespace="python-compaction",
        semantic_type="decision",
        deduplicate=False,
    )
    for index in range(10):
        brain.store(
            f"Release memory {index}. Verification is required. "
            "As previously mentioned, verification is required. "
            "Verification is required.",
            level=Level.Working,
            content_type="text/plain",
            namespace="python-compaction",
            deduplicate=False,
        )

    baseline = brain.build_context_capsule(
        "release verification", token_budget=240, namespace="python-compaction"
    )
    compacted = brain.build_compacted_context_capsule(
        "release verification", token_budget=240, namespace="python-compaction"
    )

    assert len(compacted["entries"]) > len(baseline["entries"])
    assert compacted["compaction"]["additional_entry_count"] > 0
    assert compacted["compaction"]["saved_tokens"] > 0
    assert compacted["compaction"]["originals_unchanged"] is True
    goal_entry = next(item for item in compacted["entries"] if item["record_id"] == goal_id)
    assert goal_entry["content"] == goal_text
    assert brain.get(goal_id).content == goal_text

    brain.close()
    del brain

print("python_context_compaction_smoke=ok")
