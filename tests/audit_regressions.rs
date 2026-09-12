//! Public-contract regressions from the September 2026 audit.
use aura::acl::AclVisibility;
use aura::{Aura, Level, Record};

fn put(a: &Aura, text: &str, ns: &str, parent: Option<&str>) -> anyhow::Result<Record> {
    a.store(
        text,
        Some(Level::Domain),
        None,
        None,
        Some("text/plain"),
        Some("recorded"),
        None,
        Some(false),
        parent,
        Some(ns),
        Some("fact"),
    )
}

#[test]
fn formatted_cache_preserves_namespace_case_and_query_options() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let a = Aura::open(dir.path().to_str().unwrap())?;
    put(&a, "Launch codeword is UPPER_TENANT_PRIVATE", "TeamA", None)?;
    put(&a, "Launch codeword is LOWER_TENANT_PUBLIC", "teama", None)?;
    let upper = a.recall(
        "Launch codeword",
        Some(2048),
        Some(0.0),
        Some(false),
        None,
        Some(&["TeamA"]),
    )?;
    let lower = a.recall(
        "Launch codeword",
        Some(2048),
        Some(0.0),
        Some(false),
        None,
        Some(&["teama"]),
    )?;
    assert!(upper.contains("UPPER_TENANT_PRIVATE"));
    assert!(lower.contains("LOWER_TENANT_PUBLIC"));
    assert!(!lower.contains("UPPER_TENANT_PRIVATE"));
    let small = a.recall(
        "Launch codeword",
        Some(64),
        Some(0.0),
        Some(false),
        None,
        Some(&["TeamA"]),
    )?;
    assert!(!small.contains("UPPER_TENANT_PRIVATE"));
    let excluded = a.recall(
        "Launch codeword",
        Some(2048),
        Some(2.0),
        Some(false),
        None,
        Some(&["TeamA"]),
    )?;
    assert!(!excluded.contains("UPPER_TENANT_PRIVATE"));
    Ok(())
}

#[test]
fn causal_preview_and_full_recall_respect_restricted_records() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let a = Aura::open(dir.path().to_str().unwrap())?;
    let parent = put(&a, "RESTRICTED_PARENT_7139 investigation", "public", None)?;
    a.set_record_acl(
        &parent.id,
        AclVisibility::Restricted,
        vec![],
        vec![],
        vec!["owner".into()],
        None,
    )?;
    put(
        &a,
        "Deployment release approved after the investigation",
        "public",
        Some(&parent.id),
    )?;
    assert!(put(&a, "Foreign child", "other", Some(&parent.id)).is_err());
    let formatted = a.recall(
        "Deployment release",
        Some(2048),
        Some(0.0),
        Some(false),
        None,
        Some(&["public"]),
    )?;
    assert!(formatted.contains("Deployment release"));
    assert!(!formatted.contains("RESTRICTED_PARENT_7139"));
    let full = a.recall_full(
        "RESTRICTED_PARENT_7139",
        Some(5),
        Some(true),
        Some(0.0),
        Some(false),
        None,
        Some(&["public"]),
    )?;
    assert!(full.iter().all(|(_, r)| r.id != parent.id));
    Ok(())
}

#[test]
fn deduplication_preserves_negation_numbers_and_exact_duplicates() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let a = Aura::open(dir.path().to_str().unwrap())?;
    let texts = [
        "Project Borealis policy: engineers are allowed to deploy on Friday after staging verification and owner approval. Version 1.",
        "Project Borealis policy: engineers are not allowed to deploy on Friday after staging verification and owner approval. Version 1.",
        "Project Borealis policy: engineers are allowed to deploy on Friday after staging verification and owner approval. Version 2.",
    ];
    let mut ids = vec![];
    for text in texts {
        let r = a.store(
            text,
            Some(Level::Domain),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        assert_eq!(r.content, text);
        assert!(!ids.contains(&r.id));
        ids.push(r.id);
    }
    let duplicate = a.store(
        texts[0],
        Some(Level::Domain),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;
    assert_eq!(duplicate.id, ids[0]);
    a.close()?;
    drop(a);
    let a = Aura::open(dir.path().to_str().unwrap())?;
    for (id, text) in ids.iter().zip(texts) {
        assert_eq!(a.get(id).unwrap().content, text);
    }
    Ok(())
}

#[test]
fn graph_and_embeddings_survive_restart_and_validate_input() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().to_str().unwrap();
    let (left, right);
    {
        let a = Aura::open(path)?;
        left = put(&a, "Left durable graph node", "default", None)?.id;
        right = put(&a, "Right durable graph node", "default", None)?.id;
        a.connect(&left, &right, Some(0.8), Some("causal"))?;
        a.store_embedding(&left, vec![1.0, 0.0, 0.0])?;
        assert!(a.store_embedding(&right, vec![1.0, 0.0]).is_err());
        assert!(a.store_embedding(&right, vec![f32::NAN, 0.0, 0.0]).is_err());
        assert!(a.connect(&left, &right, Some(f32::NAN), None).is_err());
        a.close()?;
    }
    let a = Aura::open(path)?;
    assert_eq!(a.get(&left).unwrap().connections.get(&right), Some(&0.8));
    assert_eq!(a.get(&right).unwrap().connections.get(&left), Some(&0.8));
    assert_eq!(
        a.get(&left)
            .unwrap()
            .connection_types
            .get(&right)
            .map(String::as_str),
        Some("causal")
    );
    assert!(a.has_embeddings());
    let rows = a.recall_with_embedding(
        "unrelated vocabulary",
        &[1.0, 0.0, 0.0],
        Some(5),
        Some(0.0),
        Some(false),
        None,
    )?;
    assert!(rows.iter().any(|(_, r)| r.id == left));
    a.delete(&left)?;
    a.close()?;
    drop(a);
    let a = Aura::open(path)?;
    assert!(!a.has_embeddings());
    Ok(())
}

#[test]
fn recall_activation_and_coactivation_survive_clean_close() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().to_str().unwrap();
    let (left, right, left_activations, edge_weight);
    {
        let aura = Aura::open(path)?;
        left = put(&aura, "Durable recall alpha marker", "default", None)?.id;
        right = put(&aura, "Durable recall beta marker", "default", None)?.id;
        let rows = aura.recall_structured(
            "Durable recall marker",
            Some(5),
            Some(0.0),
            Some(false),
            Some("durability-session"),
            None,
        )?;
        assert!(rows.iter().any(|(_, record)| record.id == left));
        assert!(rows.iter().any(|(_, record)| record.id == right));
        left_activations = aura.get(&left).unwrap().activation_count;
        edge_weight = aura.get(&left).unwrap().connections[&right];
        assert!(left_activations > 0);
        assert!(edge_weight > 0.0);
        aura.close()?;
    }
    let reopened = Aura::open(path)?;
    assert_eq!(
        reopened.get(&left).unwrap().activation_count,
        left_activations
    );
    assert_eq!(
        reopened.get(&left).unwrap().connections[&right],
        edge_weight
    );
    assert_eq!(
        reopened.get(&right).unwrap().connections[&left],
        edge_weight
    );
    Ok(())
}

#[test]
fn tied_recall_ranking_is_deterministic_after_reopen() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().to_str().unwrap();
    let aura = Aura::open(path)?;
    for index in 0..12 {
        aura.store(
            &format!("Equal ranking telemetry record number {index:02}"),
            Some(Level::Domain),
            None,
            None,
            None,
            None,
            None,
            Some(false),
            None,
            Some("deterministic"),
            None,
        )?;
    }
    let rank = |memory: &Aura| -> anyhow::Result<Vec<String>> {
        Ok(memory
            .recall_as_of(
                "Equal ranking telemetry record",
                1_000_000_000_000.0,
                Some(8),
                Some(0.0),
                Some(false),
                Some(&["deterministic"]),
            )?
            .into_iter()
            .map(|(_, record)| record.id)
            .collect())
    };
    let before = rank(&aura)?;
    aura.close()?;
    drop(aura);
    assert_eq!(rank(&Aura::open(path)?)?, before);
    Ok(())
}

#[cfg(feature = "encryption")]
#[test]
fn encrypted_memory_authenticates_and_protects_all_persistent_text() -> anyhow::Result<()> {
    fn assert_private(path: &std::path::Path, marker: &[u8]) -> anyhow::Result<()> {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                assert_private(&entry.path(), marker)?;
            } else {
                let bytes = std::fs::read(entry.path())?;
                assert!(
                    !bytes.windows(marker.len()).any(|w| w == marker),
                    "plaintext in {}",
                    entry.path().display()
                );
            }
        }
        Ok(())
    }
    let dir = tempfile::tempdir()?;
    let root = dir.path().join("brain");
    let path = root.to_str().unwrap();
    let marker = "PRIVATE_MEMORY_MARKER_827465";
    let id;
    {
        let a = Aura::open_with_password(path, Some("audit-password"))?;
        id = put(&a, marker, "default", None)?.id;
        a.store_embedding(&id, vec![1.0, 0.0, 0.0])?;
        a.recall(marker, None, None, None, None, None)?;
        a.explain_recall(marker, Some(5), Some(0.0), Some(false), None);
        a.run_maintenance();
        a.snapshot("before")?;
        a.snapshot("after")?;
        assert!(a.diff("before", "after")?.values().all(Vec::is_empty));
        a.close()?;
    }
    assert_private(dir.path(), marker.as_bytes())?;
    assert!(Aura::open(path).is_err());
    assert!(Aura::open_with_password(path, Some("wrong-password")).is_err());
    let a = Aura::open_with_password(path, Some("audit-password"))?;
    assert_eq!(a.get(&id).unwrap().content, marker);
    assert!(a.has_embeddings());
    a.rollback("before")?;
    assert_eq!(a.get(&id).unwrap().content, marker);
    a.close()?;
    assert_private(dir.path(), marker.as_bytes())?;
    Ok(())
}

#[cfg(feature = "encryption")]
#[test]
fn password_cannot_silently_retrofit_a_plaintext_history() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().to_str().unwrap();
    let a = Aura::open(path)?;
    let id = put(
        &a,
        "Existing plaintext record must be preserved",
        "default",
        None,
    )?
    .id;
    a.close()?;
    drop(a);
    assert!(Aura::open_with_password(path, Some("password")).is_err());
    assert!(!dir.path().join("memory.key").exists());
    assert!(Aura::open(path)?.get(&id).is_some());
    Ok(())
}
