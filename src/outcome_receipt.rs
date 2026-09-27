//! Observational outcome receipts.
//!
//! Receipts record which memory candidates were available, which were selected,
//! and the externally observed result. They live in the audit journal and never
//! enter recall, consolidation, strength, or retention paths.

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(feature = "python")]
use pyo3::prelude::*;

pub const OUTCOME_RECEIPT_SCHEMA_V1: u16 = 1;
pub const OUTCOME_RECEIPT_SCHEMA_VERSION: u16 = 2;
pub const MAX_OUTCOME_CANDIDATES: usize = 64;
const MAX_ID_LEN: usize = 128;
const MAX_PROVENANCE_ITEMS: usize = 16;
const MAX_PROVENANCE_ITEM_LEN: usize = 128;

/// Externally observed result for one retrieval attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "python", pyclass(eq, eq_int))]
pub enum OutcomeKind {
    Helpful,
    Unhelpful,
    Inconclusive,
}

impl OutcomeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Helpful => "helpful",
            Self::Unhelpful => "unhelpful",
            Self::Inconclusive => "inconclusive",
        }
    }
}

impl std::str::FromStr for OutcomeKind {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "helpful" | "success" | "passed" => Ok(Self::Helpful),
            "unhelpful" | "failure" | "failed" => Ok(Self::Unhelpful),
            "inconclusive" | "unknown" => Ok(Self::Inconclusive),
            _ => anyhow::bail!(
                "invalid outcome '{value}'; expected helpful, unhelpful, or inconclusive"
            ),
        }
    }
}

/// Optional terminal verdict for one candidate, supplied by an explicit
/// verifier rather than inferred from access or selection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(get_all))]
pub struct CandidateOutcomeVerdict {
    pub record_id: String,
    pub outcome: OutcomeKind,
}

impl CandidateOutcomeVerdict {
    pub fn new(record_id: impl Into<String>, outcome: OutcomeKind) -> Self {
        Self {
            record_id: record_id.into(),
            outcome,
        }
    }
}

/// Optional evidence needed for unbiased offline policy evaluation.
///
/// selected_set_probability_bps is the logging policy probability of the
/// complete selected set, expressed as exact integer basis points (1..=10000).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "python", pyclass(get_all))]
pub struct OutcomeEvaluationEvidence {
    pub logging_policy_id: Option<String>,
    pub selected_set_probability_bps: Option<u16>,
    pub candidate_verdicts: Vec<CandidateOutcomeVerdict>,
    pub verifier_id: Option<String>,
}

impl OutcomeEvaluationEvidence {
    pub fn propensity(
        logging_policy_id: impl Into<String>,
        selected_set_probability_bps: u16,
    ) -> Self {
        Self {
            logging_policy_id: Some(logging_policy_id.into()),
            selected_set_probability_bps: Some(selected_set_probability_bps),
            candidate_verdicts: Vec::new(),
            verifier_id: None,
        }
    }

    pub fn verified_candidates(
        verifier_id: impl Into<String>,
        candidate_verdicts: Vec<CandidateOutcomeVerdict>,
    ) -> Self {
        Self {
            logging_policy_id: None,
            selected_set_probability_bps: None,
            candidate_verdicts,
            verifier_id: Some(verifier_id.into()),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.logging_policy_id.is_none()
            && self.selected_set_probability_bps.is_none()
            && self.candidate_verdicts.is_empty()
            && self.verifier_id.is_none()
    }

    fn validate(&self, candidate_record_ids: &[String]) -> Result<()> {
        ensure!(
            !self.is_empty(),
            "outcome evaluation evidence must contain propensity or verifier evidence"
        );
        match (
            self.logging_policy_id.as_deref(),
            self.selected_set_probability_bps,
        ) {
            (None, None) => {}
            (Some(policy_id), Some(probability)) => {
                validate_identifier("logging_policy_id", policy_id)?;
                ensure!(
                    (1..=10_000).contains(&probability),
                    "selected_set_probability_bps must be within 1..=10000"
                );
            }
            _ => anyhow::bail!(
                "logging_policy_id and selected_set_probability_bps must be supplied together"
            ),
        }

        if self.candidate_verdicts.is_empty() {
            ensure!(
                self.verifier_id.is_none(),
                "verifier_id requires candidate_verdicts"
            );
        } else {
            let verifier_id = self
                .verifier_id
                .as_deref()
                .context("candidate_verdicts require verifier_id")?;
            validate_identifier("verifier_id", verifier_id)?;
            let verdict_ids: Vec<String> = self
                .candidate_verdicts
                .iter()
                .map(|verdict| verdict.record_id.clone())
                .collect();
            validate_record_ids("candidate_verdict record IDs", &verdict_ids)?;
            let candidates: HashSet<&str> =
                candidate_record_ids.iter().map(String::as_str).collect();
            ensure!(
                verdict_ids
                    .iter()
                    .all(|id| candidates.contains(id.as_str())),
                "candidate verdict record IDs must be a subset of candidate_record_ids"
            );
        }
        Ok(())
    }
}
/// Caller-supplied fields for one receipt.
///
/// This deliberately has no prompt, response, task text, or memory content
/// field. The audit record carries identities and categorical evidence only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutcomeReceiptDraft {
    pub task_id: String,
    pub lineage_id: String,
    pub attempt_id: String,
    pub candidate_record_ids: Vec<String>,
    pub selected_record_ids: Vec<String>,
    pub outcome: OutcomeKind,
    pub supersedes_receipt_id: Option<String>,
    pub namespace: String,
    pub provenance: Vec<String>,
    pub evaluation: Option<OutcomeEvaluationEvidence>,
}

impl OutcomeReceiptDraft {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        task_id: impl Into<String>,
        lineage_id: impl Into<String>,
        attempt_id: impl Into<String>,
        candidate_record_ids: Vec<String>,
        selected_record_ids: Vec<String>,
        outcome: OutcomeKind,
        supersedes_receipt_id: Option<String>,
        namespace: impl Into<String>,
        provenance: Vec<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            lineage_id: lineage_id.into(),
            attempt_id: attempt_id.into(),
            candidate_record_ids,
            selected_record_ids,
            outcome,
            supersedes_receipt_id,
            namespace: namespace.into(),
            provenance,
            evaluation: None,
        }
    }

    pub fn with_evaluation(mut self, evaluation: OutcomeEvaluationEvidence) -> Self {
        self.evaluation = Some(evaluation);
        self
    }

    pub fn validate(&self) -> Result<()> {
        validate_identifier("task_id", &self.task_id)?;
        validate_identifier("lineage_id", &self.lineage_id)?;
        validate_identifier("attempt_id", &self.attempt_id)?;
        validate_identifier("namespace", &self.namespace)?;
        ensure!(
            !self.candidate_record_ids.is_empty()
                && self.candidate_record_ids.len() <= MAX_OUTCOME_CANDIDATES,
            "candidate_record_ids must contain 1..={MAX_OUTCOME_CANDIDATES} values"
        );
        validate_record_ids("candidate_record_ids", &self.candidate_record_ids)?;
        validate_record_ids("selected_record_ids", &self.selected_record_ids)?;

        let candidates: HashSet<&str> = self
            .candidate_record_ids
            .iter()
            .map(String::as_str)
            .collect();
        ensure!(
            self.selected_record_ids
                .iter()
                .all(|id| candidates.contains(id.as_str())),
            "selected_record_ids must be a subset of candidate_record_ids"
        );
        if matches!(self.outcome, OutcomeKind::Helpful | OutcomeKind::Unhelpful) {
            ensure!(
                !self.selected_record_ids.is_empty(),
                "helpful and unhelpful outcomes require selected_record_ids"
            );
        }
        if let Some(receipt_id) = &self.supersedes_receipt_id {
            validate_identifier("supersedes_receipt_id", receipt_id)?;
        }
        ensure!(
            self.provenance.len() <= MAX_PROVENANCE_ITEMS,
            "provenance may contain at most {MAX_PROVENANCE_ITEMS} tokens"
        );
        for item in &self.provenance {
            ensure!(
                !item.trim().is_empty()
                    && item.len() <= MAX_PROVENANCE_ITEM_LEN
                    && !item.chars().any(char::is_control),
                "provenance tokens must be non-empty, control-free, and at most {MAX_PROVENANCE_ITEM_LEN} bytes"
            );
        }
        if let Some(evaluation) = &self.evaluation {
            evaluation.validate(&self.candidate_record_ids)?;
        }
        Ok(())
    }
}

/// Durable, content-free evidence that a retrieval attempt had an outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(get_all))]
pub struct OutcomeReceipt {
    pub schema_version: u16,
    pub receipt_id: String,
    pub task_id: String,
    pub lineage_id: String,
    pub attempt_id: String,
    pub candidate_record_ids: Vec<String>,
    pub selected_record_ids: Vec<String>,
    pub outcome: OutcomeKind,
    pub supersedes_receipt_id: Option<String>,
    pub namespace: String,
    pub provenance: Vec<String>,
    pub recorded_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logging_policy_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_set_probability_bps: Option<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidate_verdicts: Vec<CandidateOutcomeVerdict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verifier_id: Option<String>,
    pub integrity_digest: String,
}

impl OutcomeReceipt {
    pub(crate) fn from_draft(draft: OutcomeReceiptDraft) -> Result<Self> {
        draft.validate()?;
        let schema_version = if draft.evaluation.is_some() {
            OUTCOME_RECEIPT_SCHEMA_VERSION
        } else {
            OUTCOME_RECEIPT_SCHEMA_V1
        };
        let identity = format!(
            "{}\x1f{}\x1f{}\x1f{}",
            schema_version, draft.namespace, draft.task_id, draft.attempt_id
        );
        let evaluation = draft.evaluation.unwrap_or_default();
        let mut receipt = Self {
            schema_version,
            receipt_id: hex::encode(Sha256::digest(identity.as_bytes()))[..24].to_string(),
            task_id: draft.task_id,
            lineage_id: draft.lineage_id,
            attempt_id: draft.attempt_id,
            candidate_record_ids: draft.candidate_record_ids,
            selected_record_ids: draft.selected_record_ids,
            outcome: draft.outcome,
            supersedes_receipt_id: draft.supersedes_receipt_id,
            namespace: draft.namespace,
            provenance: draft.provenance,
            recorded_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            logging_policy_id: evaluation.logging_policy_id,
            selected_set_probability_bps: evaluation.selected_set_probability_bps,
            candidate_verdicts: evaluation.candidate_verdicts,
            verifier_id: evaluation.verifier_id,
            integrity_digest: String::new(),
        };
        receipt.integrity_digest = receipt.compute_integrity_digest()?;
        Ok(receipt)
    }

    pub fn evaluation(&self) -> Option<OutcomeEvaluationEvidence> {
        let evidence = OutcomeEvaluationEvidence {
            logging_policy_id: self.logging_policy_id.clone(),
            selected_set_probability_bps: self.selected_set_probability_bps,
            candidate_verdicts: self.candidate_verdicts.clone(),
            verifier_id: self.verifier_id.clone(),
        };
        (!evidence.is_empty()).then_some(evidence)
    }

    pub fn verify_integrity(&self) -> Result<()> {
        match self.schema_version {
            OUTCOME_RECEIPT_SCHEMA_V1 => {
                ensure!(
                    self.evaluation().is_none(),
                    "schema-v1 outcome receipt must not contain evaluation evidence"
                );
            }
            OUTCOME_RECEIPT_SCHEMA_VERSION => {
                self.evaluation()
                    .context("schema-v2 outcome receipt requires evaluation evidence")?
                    .validate(&self.candidate_record_ids)?;
            }
            version => anyhow::bail!("unsupported outcome receipt schema version {version}"),
        }
        ensure!(
            self.integrity_digest == self.compute_integrity_digest()?,
            "outcome receipt integrity mismatch: {}",
            self.receipt_id
        );
        Ok(())
    }

    pub(crate) fn matches_draft(&self, draft: &OutcomeReceiptDraft) -> bool {
        self.task_id == draft.task_id
            && self.lineage_id == draft.lineage_id
            && self.attempt_id == draft.attempt_id
            && self.candidate_record_ids == draft.candidate_record_ids
            && self.selected_record_ids == draft.selected_record_ids
            && self.outcome == draft.outcome
            && self.supersedes_receipt_id == draft.supersedes_receipt_id
            && self.namespace == draft.namespace
            && self.provenance == draft.provenance
            && self.evaluation() == draft.evaluation
    }

    fn compute_integrity_digest(&self) -> Result<String> {
        let bytes = match self.schema_version {
            OUTCOME_RECEIPT_SCHEMA_V1 => serde_json::to_vec(&(
                self.schema_version,
                &self.receipt_id,
                &self.task_id,
                &self.lineage_id,
                &self.attempt_id,
                &self.candidate_record_ids,
                &self.selected_record_ids,
                self.outcome,
                &self.supersedes_receipt_id,
                &self.namespace,
                &self.provenance,
                self.recorded_at_ms,
            )),
            OUTCOME_RECEIPT_SCHEMA_VERSION => serde_json::to_vec(&(
                self.schema_version,
                &self.receipt_id,
                &self.task_id,
                &self.lineage_id,
                &self.attempt_id,
                &self.candidate_record_ids,
                &self.selected_record_ids,
                self.outcome,
                &self.supersedes_receipt_id,
                &self.namespace,
                &self.provenance,
                self.recorded_at_ms,
                &self.logging_policy_id,
                self.selected_set_probability_bps,
                &self.candidate_verdicts,
                &self.verifier_id,
            )),
            version => anyhow::bail!("unsupported outcome receipt schema version {version}"),
        }
        .context("serialize outcome receipt integrity material")?;
        Ok(hex::encode(Sha256::digest(bytes)))
    }
}

fn validate_identifier(name: &str, value: &str) -> Result<()> {
    ensure!(
        !value.trim().is_empty()
            && value.len() <= MAX_ID_LEN
            && !value.chars().any(char::is_control),
        "{name} must be non-empty, control-free, and at most {MAX_ID_LEN} bytes"
    );
    Ok(())
}

fn validate_record_ids(name: &str, values: &[String]) -> Result<()> {
    for value in values {
        validate_identifier(name, value)?;
    }
    ensure!(
        values.iter().collect::<HashSet<_>>().len() == values.len(),
        "{name} must not contain duplicates"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_draft() -> OutcomeReceiptDraft {
        OutcomeReceiptDraft::new(
            "task-1",
            "lineage-1",
            "attempt-1",
            vec!["aaaa1111bbbb".into(), "cccc2222dddd".into()],
            vec!["aaaa1111bbbb".into()],
            OutcomeKind::Helpful,
            None,
            "tenant-a",
            vec!["host:test".into()],
        )
    }

    #[test]
    fn rejects_selection_outside_candidates() {
        let mut draft = valid_draft();
        draft.selected_record_ids = vec!["eeee3333ffff".into()];
        assert!(draft.validate().is_err());
    }

    #[test]
    fn terminal_outcome_requires_selected_evidence() {
        let mut draft = valid_draft();
        draft.selected_record_ids.clear();
        assert!(draft.validate().is_err());
        draft.outcome = OutcomeKind::Inconclusive;
        assert!(draft.validate().is_ok());
    }

    #[test]
    fn receipt_detects_mutation() {
        let mut receipt = OutcomeReceipt::from_draft(valid_draft()).unwrap();
        assert_eq!(receipt.schema_version, OUTCOME_RECEIPT_SCHEMA_V1);
        assert!(receipt.verify_integrity().is_ok());
        receipt.selected_record_ids = vec!["cccc2222dddd".into()];
        assert!(receipt.verify_integrity().is_err());
    }

    #[test]
    fn evaluation_evidence_uses_v2_and_is_integrity_protected() {
        let evidence = OutcomeEvaluationEvidence {
            logging_policy_id: Some("policy:exploration-v1".into()),
            selected_set_probability_bps: Some(2500),
            candidate_verdicts: vec![CandidateOutcomeVerdict::new(
                "cccc2222dddd",
                OutcomeKind::Unhelpful,
            )],
            verifier_id: Some("verifier:terminal-v1".into()),
        };
        let mut receipt =
            OutcomeReceipt::from_draft(valid_draft().with_evaluation(evidence)).unwrap();
        assert_eq!(receipt.schema_version, OUTCOME_RECEIPT_SCHEMA_VERSION);
        assert!(receipt.verify_integrity().is_ok());
        receipt.selected_set_probability_bps = Some(5000);
        assert!(receipt.verify_integrity().is_err());
    }

    #[test]
    fn rejects_incomplete_or_outside_evaluation_evidence() {
        let incomplete = OutcomeEvaluationEvidence {
            logging_policy_id: Some("policy:v1".into()),
            ..OutcomeEvaluationEvidence::default()
        };
        assert!(valid_draft()
            .with_evaluation(incomplete)
            .validate()
            .is_err());

        let outside = OutcomeEvaluationEvidence::verified_candidates(
            "verifier:v1",
            vec![CandidateOutcomeVerdict::new(
                "eeee3333ffff",
                OutcomeKind::Helpful,
            )],
        );
        assert!(valid_draft().with_evaluation(outside).validate().is_err());
    }
}
