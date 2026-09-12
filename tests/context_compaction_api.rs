use aura::{Aura, Level};

#[test]
fn compacted_capsule_is_opt_in_auditable_and_read_only() -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(directory.path().to_str().unwrap())?;
    let namespace = "compaction-api";
    let goal_content = "Active goal GOAL-31. Prepare release 1.59.0 after all tests pass. \
                        Prepare release 1.59.0 after all tests pass.";
    let goal = aura.store(
        goal_content,
        Some(Level::Working),
        Some(vec!["goal".into(), "release".into()]),
        None,
        Some("text/plain"),
        Some("recorded"),
        None,
        Some(false),
        None,
        Some(namespace),
        Some("decision"),
    )?;

    for index in 0..10 {
        aura.store(
            &format!(
                "Release memory {index}. Verification is required. \
                 As previously mentioned, verification is required. \
                 Verification is required."
            ),
            Some(Level::Working),
            None,
            None,
            Some("text/plain"),
            Some("recorded"),
            None,
            Some(false),
            None,
            Some(namespace),
            Some("fact"),
        )?;
    }

    let baseline = aura.build_context_capsule(Some(namespace), "release verification", 240)?;
    let compacted =
        aura.build_compacted_context_capsule(Some(namespace), "release verification", 240)?;

    assert!(compacted.capsule.estimated_tokens <= 240);
    assert!(compacted.capsule.entries.len() > baseline.entries.len());
    assert!(compacted.compaction.additional_entry_count > 0);
    assert!(compacted.compaction.saved_tokens > 0);
    assert!(compacted.compaction.originals_unchanged);
    assert_eq!(
        compacted
            .capsule
            .entries
            .iter()
            .find(|entry| entry.record_id == goal.id)
            .map(|entry| entry.content.as_str()),
        Some(goal_content)
    );
    assert_eq!(aura.get(&goal.id).unwrap().content, goal_content);

    let through_facade = aura.memory_api().compacted_context_capsule(
        Some(namespace),
        "release verification",
        240,
    )?;
    assert_eq!(through_facade.capsule, compacted.capsule);
    assert_eq!(through_facade.compaction, compacted.compaction);
    Ok(())
}

#[test]
fn compacted_capsule_validates_public_inputs() -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(directory.path().to_str().unwrap())?;

    assert!(aura
        .build_compacted_context_capsule(None, "  ", 100)
        .is_err());
    assert!(aura
        .build_compacted_context_capsule_as_of(None, "answer", 100, f64::NAN)
        .is_err());
    Ok(())
}
