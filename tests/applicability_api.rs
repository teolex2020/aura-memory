use std::collections::HashMap;

use aura::{
    ApplicabilityContext, ApplicabilityDecision, Aura, Level, APPLICABILITY_REQUIRE_PREFIX,
};

fn store_experience(
    aura: &Aura,
    content: &str,
    cause: Option<&str>,
    namespace: &str,
) -> anyhow::Result<String> {
    let mut metadata = HashMap::new();
    if let Some(cause) = cause {
        metadata.insert(
            format!("{APPLICABILITY_REQUIRE_PREFIX}cause"),
            cause.to_string(),
        );
        metadata.insert(
            format!("{APPLICABILITY_REQUIRE_PREFIX}environment"),
            "ready".into(),
        );
    }
    Ok(aura
        .store(
            content,
            Some(Level::Decisions),
            Some(vec!["experience".into()]),
            None,
            Some("text/plain"),
            Some("recorded"),
            Some(metadata),
            Some(false),
            None,
            Some(namespace),
            Some("decision"),
        )?
        .id)
}

fn context(fields: &[(&str, &[&str])]) -> ApplicabilityContext {
    fields
        .iter()
        .map(|(field, values)| {
            (
                (*field).to_string(),
                values.iter().map(|value| (*value).to_string()).collect(),
            )
        })
        .collect()
}

#[test]
fn direct_evaluation_is_read_only_and_abstains_on_incomplete_state() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().to_str().unwrap())?;
    let id = store_experience(
        &aura,
        "Authentication recovery: refresh the expired token",
        Some("expired_token"),
        "applicability-direct",
    )?;
    let before = aura.get(&id).expect("record exists");

    let use_report = aura
        .evaluate_applicability(
            &id,
            &context(&[("cause", &["expired_token"]), ("environment", &["ready"])]),
        )
        .expect("report exists");
    assert_eq!(use_report.decision, ApplicabilityDecision::Use);

    let reject_report = aura
        .evaluate_applicability(
            &id,
            &context(&[
                ("cause", &["permission_denied"]),
                ("environment", &["ready"]),
            ]),
        )
        .expect("report exists");
    assert_eq!(reject_report.decision, ApplicabilityDecision::Reject);
    assert_eq!(reject_report.mismatches[0].field, "cause");

    let unknown_report = aura
        .evaluate_applicability(&id, &context(&[("cause", &["expired_token"])]))
        .expect("report exists");
    assert_eq!(unknown_report.decision, ApplicabilityDecision::Unknown);
    assert_eq!(unknown_report.missing_fields, vec!["environment"]);

    let after = aura.get(&id).expect("record remains available");
    assert_eq!(after.activation_count, before.activation_count);
    assert_eq!(after.strength, before.strength);
    Ok(())
}

#[test]
fn contextual_recall_preserves_ranking_and_annotates_every_candidate() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().to_str().unwrap())?;
    let namespace = "applicability-recall";
    let expired = store_experience(
        &aura,
        "Deployment authentication recovery: refresh token and retry",
        Some("expired_token"),
        namespace,
    )?;
    let forbidden = store_experience(
        &aura,
        "Deployment authentication recovery: request access approval",
        Some("permission_denied"),
        namespace,
    )?;

    let query = "deployment authentication recovery";
    let plain = aura.recall_structured(
        query,
        Some(2),
        Some(0.0),
        Some(false),
        None,
        Some(&[namespace]),
    )?;
    let annotated = aura.recall_with_applicability(
        query,
        &context(&[
            ("cause", &["permission_denied"]),
            ("environment", &["ready"]),
        ]),
        Some(2),
        Some(0.0),
        Some(false),
        None,
        Some(&[namespace]),
    )?;

    assert_eq!(annotated.len(), 2);
    assert_eq!(
        plain
            .iter()
            .map(|(_, record)| &record.id)
            .collect::<Vec<_>>(),
        annotated
            .iter()
            .map(|result| &result.record.id)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        annotated
            .iter()
            .find(|result| result.record.id == forbidden)
            .expect("matching candidate")
            .applicability
            .decision,
        ApplicabilityDecision::Use
    );
    assert_eq!(
        annotated
            .iter()
            .find(|result| result.record.id == expired)
            .expect("mismatching candidate")
            .applicability
            .decision,
        ApplicabilityDecision::Reject
    );
    Ok(())
}

#[test]
fn applicability_requirements_persist_and_unstructured_memory_is_unknown() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let (structured_id, unstructured_id) = {
        let aura = Aura::open(dir.path().to_str().unwrap())?;
        let structured_id = store_experience(
            &aura,
            "Retry only after a transient timeout",
            Some("transient_timeout"),
            "applicability-persistence",
        )?;
        let unstructured_id = store_experience(
            &aura,
            "A loosely described historical lesson",
            None,
            "applicability-persistence",
        )?;
        aura.close()?;
        (structured_id, unstructured_id)
    };

    let reopened = Aura::open(dir.path().to_str().unwrap())?;
    let persisted = reopened
        .evaluate_applicability(
            &structured_id,
            &context(&[
                ("cause", &["transient_timeout"]),
                ("environment", &["ready"]),
            ]),
        )
        .expect("persisted report");
    assert_eq!(persisted.decision, ApplicabilityDecision::Use);

    let unstructured = reopened
        .evaluate_applicability(&unstructured_id, &ApplicabilityContext::new())
        .expect("unstructured report");
    assert_eq!(unstructured.decision, ApplicabilityDecision::Unknown);
    assert_eq!(unstructured.reasons, vec!["no_declared_requirements"]);
    Ok(())
}
