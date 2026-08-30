use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use aura::{AuditEntityKind, AuditEntityStatus, AuditRelationKind, Aura, Level};

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn store_entity(
    aura: &Aura,
    namespace: &str,
    canonical_id: &str,
    kind: AuditEntityKind,
    status: AuditEntityStatus,
) -> Result<String> {
    let semantic_type = match kind {
        AuditEntityKind::Decision => "decision",
        AuditEntityKind::Claim if status == AuditEntityStatus::Rejected => "contradiction",
        _ => "fact",
    };
    let record = aura.store_with_channel(
        &format!("audit entity {canonical_id}"),
        Some(if kind == AuditEntityKind::Decision {
            Level::Decisions
        } else {
            Level::Domain
        }),
        Some(vec!["audit-graph-test".into()]),
        Some(false),
        Some("json"),
        Some("recorded"),
        None,
        Some(false),
        None,
        Some("test"),
        Some(false),
        Some(namespace),
        Some(semantic_type),
    )?;
    aura.annotate_audit_entity(&record.id, kind, status, Some(canonical_id))?;
    Ok(record.id)
}

#[test]
fn decision_audit_graph_survives_restart_and_explains_conflict() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory
        .path()
        .to_str()
        .context("temporary path must be valid UTF-8")?;
    let aura = Aura::open(path)?;
    let namespace = "audit-decision-test";

    let source_a = store_entity(
        &aura,
        namespace,
        "source-a",
        AuditEntityKind::Source,
        AuditEntityStatus::Observed,
    )?;
    let source_b = store_entity(
        &aura,
        namespace,
        "source-b",
        AuditEntityKind::Source,
        AuditEntityStatus::Observed,
    )?;
    let source_c = store_entity(
        &aura,
        namespace,
        "source-c",
        AuditEntityKind::Source,
        AuditEntityStatus::Observed,
    )?;
    let claim_a = store_entity(
        &aura,
        namespace,
        "claim-a",
        AuditEntityKind::Claim,
        AuditEntityStatus::Accepted,
    )?;
    let claim_b = store_entity(
        &aura,
        namespace,
        "claim-b",
        AuditEntityKind::Claim,
        AuditEntityStatus::Accepted,
    )?;
    let claim_c = store_entity(
        &aura,
        namespace,
        "claim-c",
        AuditEntityKind::Claim,
        AuditEntityStatus::Rejected,
    )?;
    let decision = store_entity(
        &aura,
        namespace,
        "decision",
        AuditEntityKind::Decision,
        AuditEntityStatus::Decided,
    )?;
    let action = store_entity(
        &aura,
        namespace,
        "action",
        AuditEntityKind::Action,
        AuditEntityStatus::Completed,
    )?;
    let artifact = store_entity(
        &aura,
        namespace,
        "artifact",
        AuditEntityKind::Artifact,
        AuditEntityStatus::Produced,
    )?;
    let verification = store_entity(
        &aura,
        namespace,
        "verification",
        AuditEntityKind::Verification,
        AuditEntityStatus::Verified,
    )?;

    for (from, to, relation) in [
        (&source_a, &claim_a, AuditRelationKind::Supports),
        (&source_b, &claim_b, AuditRelationKind::Supports),
        (&source_c, &claim_c, AuditRelationKind::Supports),
        (&claim_c, &claim_a, AuditRelationKind::Contradicts),
        (&claim_a, &decision, AuditRelationKind::RecalledFor),
        (&claim_b, &decision, AuditRelationKind::RecalledFor),
        (&claim_c, &decision, AuditRelationKind::RecalledFor),
        (&decision, &action, AuditRelationKind::Caused),
        (&action, &artifact, AuditRelationKind::Produced),
        (&artifact, &verification, AuditRelationKind::VerifiedBy),
    ] {
        aura.link_audit_entities(from, to, relation, None, None)?;
    }

    let explanation = aura.explain_decision("decision")?;
    assert_eq!(explanation.evidence.len(), 3);
    assert_eq!(
        explanation
            .evidence
            .iter()
            .filter(|trace| trace.claim.status == AuditEntityStatus::Rejected)
            .count(),
        1
    );
    assert_eq!(explanation.conflicts.len(), 1);
    assert_eq!(
        explanation.conflicts[0].recommended_operation,
        "retain_rejected_claim_as_audit_scar"
    );
    assert_eq!(explanation.actions.len(), 1);
    assert_eq!(explanation.artifacts.len(), 1);
    assert_eq!(explanation.verifications.len(), 1);
    assert!(explanation.missing_links.is_empty());

    let trace = aura.trace_claim_evidence("claim-a")?;
    assert_eq!(trace.source_edges.len(), 1);
    assert_eq!(trace.decision_uses.len(), 1);
    assert_eq!(trace.conflicts.len(), 1);

    let evaluated_at = now() + 1.0;
    let before_restart = aura
        .audit_graph_at(evaluated_at, Some(namespace))?
        .to_compact_json()?;
    aura.close()?;
    drop(aura);

    let reopened = Aura::open(path)?;
    let after_restart = reopened
        .audit_graph_at(evaluated_at, Some(namespace))?
        .to_compact_json()?;
    assert_eq!(before_restart, after_restart);
    assert_eq!(reopened.explain_decision("decision")?.evidence.len(), 3);
    reopened.close()?;
    Ok(())
}

#[test]
fn audit_graph_at_respects_status_and_edge_validity() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(
        directory
            .path()
            .to_str()
            .context("temporary path must be valid UTF-8")?,
    )?;
    let namespace = "audit-time-test";
    let claim_a = store_entity(
        &aura,
        namespace,
        "temporal-claim-a",
        AuditEntityKind::Claim,
        AuditEntityStatus::Accepted,
    )?;
    let claim_b = store_entity(
        &aura,
        namespace,
        "temporal-claim-b",
        AuditEntityKind::Claim,
        AuditEntityStatus::Accepted,
    )?;
    let future = now() + 3_600.0;
    aura.set_audit_entity_status(&claim_a, AuditEntityStatus::Rejected, Some(future), None)?;
    aura.link_audit_entities(
        &claim_a,
        &claim_b,
        AuditRelationKind::Contradicts,
        Some(future),
        None,
    )?;

    let current = aura.audit_graph_at(now(), Some(namespace))?;
    let current_claim = current
        .nodes
        .iter()
        .find(|node| node.entity_id == "temporal-claim-a")
        .context("current claim must exist")?;
    assert_eq!(current_claim.status, AuditEntityStatus::Accepted);
    assert!(current.edges.is_empty());

    let future_graph = aura.audit_graph_at(future + 1.0, Some(namespace))?;
    let future_claim = future_graph
        .nodes
        .iter()
        .find(|node| node.entity_id == "temporal-claim-a")
        .context("future claim must exist")?;
    assert_eq!(future_claim.status, AuditEntityStatus::Rejected);
    assert_eq!(future_graph.edges.len(), 1);
    assert_eq!(
        future_graph.find_claim_conflicts("temporal-claim-a")?.len(),
        1
    );
    Ok(())
}

#[test]
fn audit_links_are_namespace_safe_and_schema_checked() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(
        directory
            .path()
            .to_str()
            .context("temporary path must be valid UTF-8")?,
    )?;
    let source = store_entity(
        &aura,
        "tenant-a",
        "tenant-a/source",
        AuditEntityKind::Source,
        AuditEntityStatus::Observed,
    )?;
    let foreign_claim = store_entity(
        &aura,
        "tenant-b",
        "tenant-b/claim",
        AuditEntityKind::Claim,
        AuditEntityStatus::Candidate,
    )?;
    let artifact = store_entity(
        &aura,
        "tenant-a",
        "tenant-a/artifact",
        AuditEntityKind::Artifact,
        AuditEntityStatus::Produced,
    )?;

    assert!(aura
        .link_audit_entities(
            &source,
            &foreign_claim,
            AuditRelationKind::Supports,
            None,
            None,
        )
        .is_err());
    assert!(aura
        .link_audit_entities(&source, &artifact, AuditRelationKind::Supports, None, None,)
        .is_err());
    assert!(aura
        .annotate_audit_entity(
            &artifact,
            AuditEntityKind::Artifact,
            AuditEntityStatus::Produced,
            Some("tenant-a/source"),
        )
        .is_err());

    let mut ordinary_metadata = HashMap::new();
    ordinary_metadata.insert("owner".into(), "agent-a".into());
    aura.update(
        &artifact,
        None,
        None,
        None,
        None,
        Some(ordinary_metadata),
        None,
    )?;
    assert!(aura
        .audit_graph(Some("tenant-a"))?
        .nodes
        .iter()
        .any(|node| node.entity_id == "tenant-a/artifact"));

    let mut reserved_metadata = HashMap::new();
    reserved_metadata.insert(
        aura::audit_graph::AUDIT_ENTITY_ID_KEY.into(),
        "tampered".into(),
    );
    assert!(aura
        .update(
            &artifact,
            None,
            None,
            None,
            None,
            Some(reserved_metadata),
            None,
        )
        .is_err());
    Ok(())
}
