//! Regression tests inspired by the failure modes reported for native/latent
//! memory systems such as Metis: bounded capacity, interference from unrelated
//! state, weakening of early facts, and incomplete forgetting.
//!
//! Aura is an explicit memory store rather than a fixed-size latent state, so
//! these tests assert the product-level guarantees callers should be able to
//! rely on regardless of the model connected to the SDK.

use aura::{Aura, Level};

fn store_fact(aura: &Aura, content: &str, namespace: &str) -> anyhow::Result<String> {
    Ok(aura
        .store(
            content,
            Some(Level::Domain),
            Some(vec!["memory-resilience".into()]),
            None,
            Some("text/plain"),
            Some("recorded"),
            None,
            Some(false),
            None,
            Some(namespace),
            Some("fact"),
        )?
        .id)
}

#[test]
fn early_fact_survives_many_later_writes_and_reopen() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let namespace = "metis-capacity";
    let early_id = {
        let aura = Aura::open(dir.path().to_str().unwrap())?;
        let early_id = store_fact(
            &aura,
            "The immutable launch marker is AURA-EARLY-7391",
            namespace,
        )?;

        for index in 0..512 {
            store_fact(
                &aura,
                &format!("Later unrelated observation number {index} concerns routine telemetry"),
                namespace,
            )?;
        }

        assert_eq!(
            aura.get(&early_id).map(|record| record.content),
            Some("The immutable launch marker is AURA-EARLY-7391".into())
        );
        aura.close()?;
        early_id
    };

    let reopened = Aura::open(dir.path().to_str().unwrap())?;
    let rows = reopened.recall_structured(
        "AURA-EARLY-7391 launch marker",
        Some(10),
        Some(0.0),
        Some(false),
        None,
        Some(&[namespace]),
    )?;

    assert!(
        rows.iter().any(|(_, record)| record.id == early_id),
        "an early fact must remain retrievable after later writes and restart"
    );
    Ok(())
}

#[test]
fn unrelated_memory_does_not_displace_exact_recall() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().to_str().unwrap())?;
    let namespace = "metis-interference";
    let target_id = store_fact(
        &aura,
        "Project Borealis deployment checksum is ZEPHYR-8842",
        namespace,
    )?;

    // Deliberately reuse the surrounding vocabulary. Only the target contains
    // the exact identifying marker, so irrelevant state must not overwhelm it.
    for index in 0..256 {
        store_fact(
            &aura,
            &format!(
                "Project Borealis deployment telemetry sample {index} has routine checksum status"
            ),
            namespace,
        )?;
    }

    let rows = aura.recall_structured(
        "Project Borealis deployment checksum ZEPHYR-8842",
        Some(5),
        Some(0.0),
        Some(false),
        None,
        Some(&[namespace]),
    )?;

    assert_eq!(
        rows.first().map(|(_, record)| record.id.as_str()),
        Some(target_id.as_str()),
        "similar distractors must not displace an exact memory match"
    );
    Ok(())
}

#[test]
fn deletion_invalidates_hot_recall_and_survives_restart() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let namespace = "metis-forgetting";
    let forgotten_id = {
        let aura = Aura::open(dir.path().to_str().unwrap())?;
        let forgotten_id = store_fact(
            &aura,
            "Temporary access phrase is FORGET-ME-4419",
            namespace,
        )?;

        // Warm the recall cache before deletion. This catches implementations
        // that delete storage but accidentally keep serving a stale result.
        let before = aura.recall_structured(
            "FORGET-ME-4419",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&[namespace]),
        )?;
        assert!(before.iter().any(|(_, record)| record.id == forgotten_id));

        assert!(aura.delete(&forgotten_id)?);
        assert!(aura.get(&forgotten_id).is_none());
        let after = aura.recall_structured(
            "FORGET-ME-4419",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&[namespace]),
        )?;
        assert!(after.iter().all(|(_, record)| record.id != forgotten_id));
        assert!(aura
            .search(
                Some("FORGET-ME-4419"),
                None,
                None,
                Some(10),
                None,
                None,
                Some(&[namespace]),
                None,
            )
            .is_empty());
        aura.close()?;
        forgotten_id
    };

    let reopened = Aura::open(dir.path().to_str().unwrap())?;
    assert!(reopened.get(&forgotten_id).is_none());
    assert!(reopened
        .recall_structured(
            "FORGET-ME-4419",
            Some(10),
            Some(0.0),
            Some(false),
            None,
            Some(&[namespace]),
        )?
        .iter()
        .all(|(_, record)| record.id != forgotten_id));
    Ok(())
}

#[test]
fn bounded_context_is_stable_under_irrelevant_working_memory() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().to_str().unwrap())?;
    let namespace = "metis-context-noise";
    let goal = aura.store(
        "Release goal: ship Borealis after verifying ZEPHYR-8842",
        Some(Level::Working),
        Some(vec!["goal".into(), "borealis".into()]),
        None,
        None,
        Some("recorded"),
        None,
        Some(false),
        None,
        Some(namespace),
        Some("decision"),
    )?;

    for index in 0..256 {
        aura.store(
            &format!("Unrelated transient chat fragment {index} about gardening"),
            Some(Level::Working),
            Some(vec!["transient".into()]),
            None,
            None,
            Some("recorded"),
            None,
            Some(false),
            None,
            Some(namespace),
            Some("fact"),
        )?;
    }

    let capsule = aura.build_context_capsule(
        Some(namespace),
        "continue Borealis release verification",
        96,
    )?;
    assert!(capsule.estimated_tokens <= 96);
    assert!(capsule
        .entries
        .iter()
        .any(|entry| entry.record_id == goal.id));
    assert!(capsule
        .entries
        .iter()
        .all(|entry| !entry.content.contains("gardening")));
    Ok(())
}
