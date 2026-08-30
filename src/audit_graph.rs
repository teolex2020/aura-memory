//! Rebuildable evidence and decision audit graph.
//!
//! The graph is a deterministic read-model over ordinary Aura records. Its
//! directed edges and status history are stored in reserved record metadata;
//! no second database or graph runtime is required.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::str::FromStr;

use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};

use crate::record::Record;

pub const AUDIT_ENTITY_ID_KEY: &str = "aura.audit.v1.entity_id";
pub const AUDIT_ENTITY_KIND_KEY: &str = "aura.audit.v1.entity_kind";
pub const AUDIT_STATUS_EVENTS_KEY: &str = "aura.audit.v1.status_events";
pub const AUDIT_EDGES_KEY: &str = "aura.audit.v1.edges";
pub const AUDIT_SCHEMA_VERSION: u32 = 1;
pub(crate) const AUDIT_METADATA_PREFIX: &str = "aura.audit.v1.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEntityKind {
    Source,
    Claim,
    Memory,
    Decision,
    Action,
    Artifact,
    Verification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEntityStatus {
    Candidate,
    Observed,
    Accepted,
    Verified,
    Rejected,
    Superseded,
    Blocked,
    Decided,
    Completed,
    Produced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditRelationKind {
    Supports,
    Refutes,
    Contradicts,
    Supersedes,
    DerivedFrom,
    RecalledFor,
    UsedEvidence,
    UsedBy,
    Caused,
    Produced,
    VerifiedBy,
}

macro_rules! impl_string_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = anyhow::Error;

            fn from_str(value: &str) -> Result<Self> {
                match value.trim().to_ascii_lowercase().as_str() {
                    $($value => Ok(Self::$variant)),+,
                    _ => bail!("unsupported {}: '{}'", stringify!($name), value),
                }
            }
        }
    };
}

impl_string_enum!(AuditEntityKind {
    Source => "source",
    Claim => "claim",
    Memory => "memory",
    Decision => "decision",
    Action => "action",
    Artifact => "artifact",
    Verification => "verification",
});

impl_string_enum!(AuditEntityStatus {
    Candidate => "candidate",
    Observed => "observed",
    Accepted => "accepted",
    Verified => "verified",
    Rejected => "rejected",
    Superseded => "superseded",
    Blocked => "blocked",
    Decided => "decided",
    Completed => "completed",
    Produced => "produced",
});

impl_string_enum!(AuditRelationKind {
    Supports => "supports",
    Refutes => "refutes",
    Contradicts => "contradicts",
    Supersedes => "supersedes",
    DerivedFrom => "derived_from",
    RecalledFor => "recalled_for",
    UsedEvidence => "used_evidence",
    UsedBy => "used_by",
    Caused => "caused",
    Produced => "produced",
    VerifiedBy => "verified_by",
});

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct AuditStatusEvent {
    #[serde(rename = "s")]
    pub status: AuditEntityStatus,
    #[serde(rename = "r")]
    pub recorded_at: f64,
    #[serde(rename = "f", skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<f64>,
    #[serde(rename = "u", skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct StoredAuditEdge {
    #[serde(rename = "r")]
    pub relation: AuditRelationKind,
    #[serde(rename = "t")]
    pub to_entity_id: String,
    #[serde(rename = "k")]
    pub recorded_at: f64,
    #[serde(rename = "f", skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<f64>,
    #[serde(rename = "u", skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditNode {
    pub entity_id: String,
    pub record_id: String,
    pub namespace: String,
    pub kind: AuditEntityKind,
    pub status: AuditEntityStatus,
    pub status_recorded_at: f64,
    pub record_created_at: f64,
    pub valid_from: Option<f64>,
    pub valid_until: Option<f64>,
    pub business_time_valid: bool,
    pub content_preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEdge {
    pub from_entity_id: String,
    pub from_record_id: String,
    pub to_entity_id: String,
    pub to_record_id: String,
    pub relation: AuditRelationKind,
    pub recorded_at: f64,
    pub valid_from: Option<f64>,
    pub valid_until: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditGraph {
    pub schema_version: u32,
    pub evaluated_at: f64,
    pub namespace: Option<String>,
    pub nodes: Vec<AuditNode>,
    pub edges: Vec<AuditEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEvidenceTrace {
    pub claim: AuditNode,
    pub use_relation: AuditRelationKind,
    pub source_edges: Vec<AuditEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditConflict {
    pub claim: AuditNode,
    pub opposing_claim: AuditNode,
    pub relation: AuditRelationKind,
    pub claim_sources: Vec<AuditEdge>,
    pub opposing_sources: Vec<AuditEdge>,
    pub recommended_operation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionAuditExplanation {
    pub decision: AuditNode,
    pub evidence: Vec<AuditEvidenceTrace>,
    pub conflicts: Vec<AuditConflict>,
    pub actions: Vec<AuditNode>,
    pub artifacts: Vec<AuditNode>,
    pub verifications: Vec<AuditNode>,
    pub missing_links: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaimEvidenceTrace {
    pub claim: AuditNode,
    pub source_edges: Vec<AuditEdge>,
    pub decision_uses: Vec<AuditNode>,
    pub conflicts: Vec<AuditConflict>,
}

impl AuditStatusEvent {
    pub(crate) fn is_visible_at(&self, timestamp: f64) -> bool {
        self.recorded_at <= timestamp
            && interval_contains(self.valid_from, self.valid_until, timestamp)
    }
}

impl StoredAuditEdge {
    pub(crate) fn is_visible_at(&self, timestamp: f64) -> bool {
        self.recorded_at <= timestamp
            && interval_contains(self.valid_from, self.valid_until, timestamp)
    }
}

impl AuditGraph {
    pub(crate) fn from_records(
        records: &HashMap<String, Record>,
        evaluated_at: f64,
        namespace: Option<&str>,
    ) -> Result<Self> {
        ensure!(evaluated_at.is_finite(), "evaluated_at must be finite");

        let mut nodes_by_entity = BTreeMap::new();
        for record in records.values() {
            if record.created_at > evaluated_at
                || namespace.is_some_and(|expected| record.namespace != expected)
            {
                continue;
            }
            let Some(entity_id) = record.metadata.get(AUDIT_ENTITY_ID_KEY) else {
                continue;
            };
            validate_entity_id(entity_id)?;
            let kind: AuditEntityKind = read_json_metadata(record, AUDIT_ENTITY_KIND_KEY)?;
            let events: Vec<AuditStatusEvent> =
                read_json_metadata(record, AUDIT_STATUS_EVENTS_KEY)?;
            let Some(status_event) = events
                .iter()
                .enumerate()
                .filter(|(_, event)| event.is_visible_at(evaluated_at))
                .max_by(|(left_index, left), (right_index, right)| {
                    left.recorded_at
                        .total_cmp(&right.recorded_at)
                        .then_with(|| left_index.cmp(right_index))
                })
                .map(|(_, event)| event)
            else {
                continue;
            };

            let node = AuditNode {
                entity_id: entity_id.clone(),
                record_id: record.id.clone(),
                namespace: record.namespace.clone(),
                kind,
                status: status_event.status,
                status_recorded_at: canonical_timestamp(status_event.recorded_at),
                record_created_at: canonical_timestamp(record.created_at),
                valid_from: record.valid_from.map(canonical_timestamp),
                valid_until: record.valid_until.map(canonical_timestamp),
                business_time_valid: record.is_valid_at(evaluated_at),
                content_preview: preview(&record.content, 240),
            };
            ensure!(
                nodes_by_entity.insert(entity_id.clone(), node).is_none(),
                "duplicate audit entity ID: {entity_id}"
            );
        }

        let record_to_entity = nodes_by_entity
            .values()
            .map(|node| (node.record_id.clone(), node.entity_id.clone()))
            .collect::<HashMap<_, _>>();
        let mut edges = Vec::new();
        for record in records.values() {
            let Some(from_entity_id) = record_to_entity.get(&record.id) else {
                continue;
            };
            let stored_edges: Vec<StoredAuditEdge> = match record.metadata.get(AUDIT_EDGES_KEY) {
                Some(raw) => serde_json::from_str(raw).with_context(|| {
                    format!("record {} has invalid {AUDIT_EDGES_KEY}", record.id)
                })?,
                None => Vec::new(),
            };
            for stored in stored_edges
                .into_iter()
                .filter(|edge| edge.is_visible_at(evaluated_at))
            {
                let Some(target) = nodes_by_entity.get(&stored.to_entity_id) else {
                    continue;
                };
                let source = nodes_by_entity
                    .get(from_entity_id)
                    .expect("source entity was indexed");
                validate_relation(source.kind, target.kind, stored.relation)?;
                edges.push(AuditEdge {
                    from_entity_id: from_entity_id.clone(),
                    from_record_id: source.record_id.clone(),
                    to_entity_id: target.entity_id.clone(),
                    to_record_id: target.record_id.clone(),
                    relation: stored.relation,
                    recorded_at: canonical_timestamp(stored.recorded_at),
                    valid_from: stored.valid_from.map(canonical_timestamp),
                    valid_until: stored.valid_until.map(canonical_timestamp),
                });
            }
        }
        edges.sort_by(|left, right| {
            left.from_entity_id
                .cmp(&right.from_entity_id)
                .then_with(|| left.relation.cmp(&right.relation))
                .then_with(|| left.to_entity_id.cmp(&right.to_entity_id))
                .then_with(|| left.recorded_at.total_cmp(&right.recorded_at))
        });

        Ok(Self {
            schema_version: AUDIT_SCHEMA_VERSION,
            evaluated_at,
            namespace: namespace.map(str::to_string),
            nodes: nodes_by_entity.into_values().collect(),
            edges,
        })
    }

    pub fn explain_decision(&self, decision_id: &str) -> Result<DecisionAuditExplanation> {
        let decision = self.resolve_node(decision_id)?.clone();
        ensure!(
            decision.kind == AuditEntityKind::Decision,
            "entity '{}' is not a decision",
            decision.entity_id
        );

        let mut evidence_links = self
            .edges
            .iter()
            .filter_map(|edge| match edge.relation {
                AuditRelationKind::RecalledFor | AuditRelationKind::UsedBy
                    if edge.to_entity_id == decision.entity_id =>
                {
                    Some((edge.from_entity_id.clone(), edge.relation))
                }
                AuditRelationKind::UsedEvidence if edge.from_entity_id == decision.entity_id => {
                    Some((edge.to_entity_id.clone(), edge.relation))
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        evidence_links.sort();
        evidence_links.dedup();

        let evidence = evidence_links
            .into_iter()
            .map(|(claim_id, use_relation)| {
                let claim = self.resolve_node(&claim_id)?.clone();
                ensure!(
                    matches!(claim.kind, AuditEntityKind::Claim | AuditEntityKind::Memory),
                    "decision evidence '{}' is not a claim or memory",
                    claim.entity_id
                );
                Ok(AuditEvidenceTrace {
                    source_edges: self.source_edges(&claim.entity_id),
                    claim,
                    use_relation,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        let claim_ids = evidence
            .iter()
            .map(|trace| trace.claim.entity_id.clone())
            .collect::<BTreeSet<_>>();
        let mut conflicts = Vec::new();
        for claim_id in &claim_ids {
            conflicts.extend(self.find_claim_conflicts(claim_id)?);
        }
        conflicts.sort_by(|left, right| {
            left.claim
                .entity_id
                .cmp(&right.claim.entity_id)
                .then_with(|| {
                    left.opposing_claim
                        .entity_id
                        .cmp(&right.opposing_claim.entity_id)
                })
        });
        conflicts.dedup_by(|left, right| {
            let left_pair = ordered_pair(&left.claim.entity_id, &left.opposing_claim.entity_id);
            let right_pair = ordered_pair(&right.claim.entity_id, &right.opposing_claim.entity_id);
            left_pair == right_pair
        });

        let actions = self.target_nodes(&decision.entity_id, AuditRelationKind::Caused);
        let artifacts = actions
            .iter()
            .flat_map(|action| self.target_nodes(&action.entity_id, AuditRelationKind::Produced))
            .map(|node| (node.entity_id.clone(), node))
            .collect::<BTreeMap<_, _>>()
            .into_values()
            .collect::<Vec<_>>();
        let verifications = artifacts
            .iter()
            .flat_map(|artifact| {
                self.target_nodes(&artifact.entity_id, AuditRelationKind::VerifiedBy)
            })
            .map(|node| (node.entity_id.clone(), node))
            .collect::<BTreeMap<_, _>>()
            .into_values()
            .collect::<Vec<_>>();

        let mut missing_links = Vec::new();
        if evidence.is_empty() {
            missing_links.push("evidence".into());
        }
        if actions.is_empty() {
            missing_links.push("action".into());
        }
        if !actions.is_empty() && artifacts.is_empty() {
            missing_links.push("artifact".into());
        }
        if !artifacts.is_empty() && verifications.is_empty() {
            missing_links.push("verification".into());
        }

        Ok(DecisionAuditExplanation {
            decision,
            evidence,
            conflicts,
            actions,
            artifacts,
            verifications,
            missing_links,
        })
    }

    pub fn trace_claim_evidence(&self, claim_id: &str) -> Result<ClaimEvidenceTrace> {
        let claim = self.resolve_node(claim_id)?.clone();
        ensure!(
            matches!(claim.kind, AuditEntityKind::Claim | AuditEntityKind::Memory),
            "entity '{}' is not a claim or memory",
            claim.entity_id
        );
        let mut decision_ids = BTreeSet::new();
        for edge in &self.edges {
            match edge.relation {
                AuditRelationKind::RecalledFor | AuditRelationKind::UsedBy
                    if edge.from_entity_id == claim.entity_id =>
                {
                    decision_ids.insert(edge.to_entity_id.clone());
                }
                AuditRelationKind::UsedEvidence if edge.to_entity_id == claim.entity_id => {
                    decision_ids.insert(edge.from_entity_id.clone());
                }
                _ => {}
            }
        }
        let decision_uses = decision_ids
            .iter()
            .map(|id| self.resolve_node(id).cloned())
            .collect::<Result<Vec<_>>>()?;

        Ok(ClaimEvidenceTrace {
            source_edges: self.source_edges(&claim.entity_id),
            conflicts: self.find_claim_conflicts(&claim.entity_id)?,
            claim,
            decision_uses,
        })
    }

    pub fn find_claim_conflicts(&self, claim_id: &str) -> Result<Vec<AuditConflict>> {
        let claim = self.resolve_node(claim_id)?.clone();
        ensure!(
            matches!(claim.kind, AuditEntityKind::Claim | AuditEntityKind::Memory),
            "entity '{}' is not a claim or memory",
            claim.entity_id
        );

        let mut conflicts = Vec::new();
        for edge in &self.edges {
            if !matches!(
                edge.relation,
                AuditRelationKind::Contradicts | AuditRelationKind::Supersedes
            ) {
                continue;
            }
            let opposing_id = if edge.from_entity_id == claim.entity_id {
                Some(edge.to_entity_id.as_str())
            } else if edge.to_entity_id == claim.entity_id {
                Some(edge.from_entity_id.as_str())
            } else {
                None
            };
            let Some(opposing_id) = opposing_id else {
                continue;
            };
            let opposing_claim = self.resolve_node(opposing_id)?.clone();
            conflicts.push(AuditConflict {
                claim_sources: self.source_edges(&claim.entity_id),
                opposing_sources: self.source_edges(&opposing_claim.entity_id),
                recommended_operation: recommended_conflict_operation(
                    claim.status,
                    opposing_claim.status,
                    edge.relation,
                ),
                claim: claim.clone(),
                opposing_claim,
                relation: edge.relation,
            });
        }
        conflicts.sort_by(|left, right| {
            left.opposing_claim
                .entity_id
                .cmp(&right.opposing_claim.entity_id)
        });
        Ok(conflicts)
    }

    pub fn to_compact_json(&self) -> Result<String> {
        serde_json::to_string(self).context("failed to serialize audit graph")
    }

    fn resolve_node(&self, id: &str) -> Result<&AuditNode> {
        self.nodes
            .iter()
            .find(|node| node.entity_id == id || node.record_id == id)
            .with_context(|| format!("audit entity not found: {id}"))
    }

    fn source_edges(&self, claim_id: &str) -> Vec<AuditEdge> {
        self.edges
            .iter()
            .filter(|edge| {
                (matches!(
                    edge.relation,
                    AuditRelationKind::Supports | AuditRelationKind::Refutes
                ) && edge.to_entity_id == claim_id)
                    || (edge.relation == AuditRelationKind::DerivedFrom
                        && edge.from_entity_id == claim_id)
            })
            .cloned()
            .collect()
    }

    fn target_nodes(&self, from_entity_id: &str, relation: AuditRelationKind) -> Vec<AuditNode> {
        self.edges
            .iter()
            .filter(|edge| edge.from_entity_id == from_entity_id && edge.relation == relation)
            .filter_map(|edge| self.resolve_node(&edge.to_entity_id).ok().cloned())
            .collect()
    }
}

pub(crate) fn read_entity_id(record: &Record) -> Option<&str> {
    record.metadata.get(AUDIT_ENTITY_ID_KEY).map(String::as_str)
}

pub(crate) fn is_reserved_audit_metadata_key(key: &str) -> bool {
    key.starts_with(AUDIT_METADATA_PREFIX)
}

pub(crate) fn read_entity_kind(record: &Record) -> Result<AuditEntityKind> {
    read_json_metadata(record, AUDIT_ENTITY_KIND_KEY)
}

pub(crate) fn read_status_events(record: &Record) -> Result<Vec<AuditStatusEvent>> {
    match record.metadata.get(AUDIT_STATUS_EVENTS_KEY) {
        Some(raw) => serde_json::from_str(raw)
            .with_context(|| format!("record {} has invalid {AUDIT_STATUS_EVENTS_KEY}", record.id)),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn read_stored_edges(record: &Record) -> Result<Vec<StoredAuditEdge>> {
    match record.metadata.get(AUDIT_EDGES_KEY) {
        Some(raw) => serde_json::from_str(raw)
            .with_context(|| format!("record {} has invalid {AUDIT_EDGES_KEY}", record.id)),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn write_annotation(
    record: &mut Record,
    entity_id: &str,
    kind: AuditEntityKind,
    events: &[AuditStatusEvent],
) -> Result<()> {
    validate_entity_id(entity_id)?;
    ensure!(!events.is_empty(), "audit status history cannot be empty");
    record
        .metadata
        .insert(AUDIT_ENTITY_ID_KEY.into(), entity_id.into());
    record
        .metadata
        .insert(AUDIT_ENTITY_KIND_KEY.into(), serde_json::to_string(&kind)?);
    record.metadata.insert(
        AUDIT_STATUS_EVENTS_KEY.into(),
        serde_json::to_string(events)?,
    );
    Ok(())
}

pub(crate) fn write_stored_edges(record: &mut Record, edges: &[StoredAuditEdge]) -> Result<()> {
    record
        .metadata
        .insert(AUDIT_EDGES_KEY.into(), serde_json::to_string(edges)?);
    Ok(())
}

pub(crate) fn validate_temporal_interval(
    valid_from: Option<f64>,
    valid_until: Option<f64>,
) -> Result<()> {
    if valid_from.is_some_and(|value| !value.is_finite()) {
        bail!("valid_from must be finite");
    }
    if valid_until.is_some_and(|value| !value.is_finite()) {
        bail!("valid_until must be finite");
    }
    if let (Some(start), Some(end)) = (valid_from, valid_until) {
        ensure!(start < end, "valid_from must be earlier than valid_until");
    }
    Ok(())
}

pub(crate) fn validate_entity_id(entity_id: &str) -> Result<()> {
    let trimmed = entity_id.trim();
    ensure!(!trimmed.is_empty(), "audit entity ID cannot be empty");
    ensure!(
        trimmed.len() <= 512,
        "audit entity ID cannot exceed 512 bytes"
    );
    ensure!(
        !trimmed.chars().any(char::is_control),
        "audit entity ID cannot contain control characters"
    );
    ensure!(
        trimmed == entity_id,
        "audit entity ID cannot have outer whitespace"
    );
    Ok(())
}

pub(crate) fn validate_relation(
    source: AuditEntityKind,
    target: AuditEntityKind,
    relation: AuditRelationKind,
) -> Result<()> {
    let valid = match relation {
        AuditRelationKind::Supports | AuditRelationKind::Refutes => {
            matches!(target, AuditEntityKind::Claim | AuditEntityKind::Memory)
        }
        AuditRelationKind::Contradicts | AuditRelationKind::Supersedes => {
            matches!(source, AuditEntityKind::Claim | AuditEntityKind::Memory)
                && matches!(target, AuditEntityKind::Claim | AuditEntityKind::Memory)
        }
        AuditRelationKind::RecalledFor | AuditRelationKind::UsedBy => {
            matches!(source, AuditEntityKind::Claim | AuditEntityKind::Memory)
                && target == AuditEntityKind::Decision
        }
        AuditRelationKind::UsedEvidence => {
            source == AuditEntityKind::Decision
                && matches!(target, AuditEntityKind::Claim | AuditEntityKind::Memory)
        }
        AuditRelationKind::Caused => {
            matches!(source, AuditEntityKind::Decision | AuditEntityKind::Action)
                && target == AuditEntityKind::Action
        }
        AuditRelationKind::Produced => {
            source == AuditEntityKind::Action && target == AuditEntityKind::Artifact
        }
        AuditRelationKind::VerifiedBy => {
            source == AuditEntityKind::Artifact && target == AuditEntityKind::Verification
        }
        AuditRelationKind::DerivedFrom => source != target,
    };
    ensure!(
        valid,
        "relation '{}' is invalid for {} -> {}",
        relation,
        source,
        target
    );
    Ok(())
}

fn read_json_metadata<T>(record: &Record, key: &str) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let raw = record
        .metadata
        .get(key)
        .with_context(|| format!("record {} is missing {key}", record.id))?;
    serde_json::from_str(raw).with_context(|| format!("record {} has invalid {key}", record.id))
}

fn interval_contains(valid_from: Option<f64>, valid_until: Option<f64>, timestamp: f64) -> bool {
    valid_from.is_none_or(|start| timestamp >= start)
        && valid_until.is_none_or(|end| timestamp < end)
}

fn canonical_timestamp(timestamp: f64) -> f64 {
    // Aura's JSON journal is authoritative after restart. Millisecond
    // canonicalization prevents insignificant in-memory floating-point tails
    // from changing an otherwise identical audit export.
    (timestamp * 1_000.0).round() / 1_000.0
}

fn recommended_conflict_operation(
    left: AuditEntityStatus,
    right: AuditEntityStatus,
    relation: AuditRelationKind,
) -> String {
    if relation == AuditRelationKind::Supersedes
        || matches!(left, AuditEntityStatus::Superseded)
        || matches!(right, AuditEntityStatus::Superseded)
    {
        "prefer_current_version_and_retain_superseded_history".into()
    } else if matches!(
        left,
        AuditEntityStatus::Rejected | AuditEntityStatus::Blocked
    ) ^ matches!(
        right,
        AuditEntityStatus::Rejected | AuditEntityStatus::Blocked
    ) {
        "retain_rejected_claim_as_audit_scar".into()
    } else {
        "manual_review_required".into()
    }
}

fn ordered_pair<'a>(left: &'a str, right: &'a str) -> (&'a str, &'a str) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn preview(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let preview = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn string_enums_round_trip() -> Result<()> {
        for value in [
            AuditRelationKind::Supports,
            AuditRelationKind::Contradicts,
            AuditRelationKind::VerifiedBy,
        ] {
            assert_eq!(AuditRelationKind::from_str(value.as_str())?, value);
            assert_eq!(
                serde_json::from_str::<AuditRelationKind>(&serde_json::to_string(&value)?)?,
                value
            );
        }
        Ok(())
    }

    #[test]
    fn relation_schema_rejects_invalid_direction() {
        assert!(validate_relation(
            AuditEntityKind::Artifact,
            AuditEntityKind::Verification,
            AuditRelationKind::VerifiedBy
        )
        .is_ok());
        assert!(validate_relation(
            AuditEntityKind::Verification,
            AuditEntityKind::Artifact,
            AuditRelationKind::VerifiedBy
        )
        .is_err());
    }
}
