//! Deterministic applicability checks for retrieved experiential memory.
//!
//! Relevance answers "is this memory about the current query?". Applicability
//! answers the separate question "are its declared preconditions satisfied by
//! the current state?". Aura never invents missing state: incomplete,
//! conflicting, or unstructured input produces [`ApplicabilityDecision::Unknown`].

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::record::Record;

/// Metadata prefix used to declare a hard applicability precondition.
///
/// For example, `applicability.require.error_kind = "expired_token"` means
/// the caller must provide exactly one matching `error_kind` value before Aura
/// can classify the memory as directly usable.
pub const APPLICABILITY_REQUIRE_PREFIX: &str = "applicability.require.";

/// Current state supplied by the host agent.
///
/// Multiple values are accepted so contradictory observations can be
/// represented explicitly. A required field with zero or multiple distinct
/// values yields `UNKNOWN` rather than an unsafe guess.
pub type ApplicabilityContext = HashMap<String, Vec<String>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplicabilityDecision {
    Use,
    Reject,
    Unknown,
}

impl ApplicabilityDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Use => "use",
            Self::Reject => "reject",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplicabilityMismatch {
    pub field: String,
    pub expected: String,
    pub actual: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplicabilityConflict {
    pub field: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplicabilityReport {
    pub record_id: String,
    pub decision: ApplicabilityDecision,
    pub requirements_total: usize,
    pub matched_fields: Vec<String>,
    pub missing_fields: Vec<String>,
    pub conflicting_fields: Vec<ApplicabilityConflict>,
    pub mismatches: Vec<ApplicabilityMismatch>,
    pub invalid_requirement_fields: Vec<String>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicabilityRecallResult {
    pub score: f32,
    pub record: Record,
    pub applicability: ApplicabilityReport,
}

/// Evaluate one record without mutating it or invoking a model.
pub fn evaluate_applicability(
    record: &Record,
    current_state: &ApplicabilityContext,
) -> ApplicabilityReport {
    let requirements: BTreeMap<String, String> = record
        .metadata
        .iter()
        .filter_map(|(key, value)| {
            key.strip_prefix(APPLICABILITY_REQUIRE_PREFIX)
                .map(|field| (field.trim().to_string(), value.trim().to_string()))
        })
        .collect();

    let normalized_state: BTreeMap<String, Vec<String>> = current_state
        .iter()
        .map(|(field, values)| (field.trim().to_string(), normalized_values(values)))
        .collect();

    let mut matched_fields = Vec::new();
    let mut missing_fields = Vec::new();
    let mut conflicting_fields = Vec::new();
    let mut mismatches = Vec::new();
    let mut invalid_requirement_fields = Vec::new();

    for (field, expected) in &requirements {
        if field.is_empty() || expected.is_empty() {
            invalid_requirement_fields.push(field.clone());
            continue;
        }
        let Some(actual) = normalized_state.get(field) else {
            missing_fields.push(field.clone());
            continue;
        };
        if actual.is_empty() {
            missing_fields.push(field.clone());
            continue;
        }
        if actual.len() > 1 {
            conflicting_fields.push(ApplicabilityConflict {
                field: field.clone(),
                values: actual.clone(),
            });
            continue;
        }
        if actual[0].eq_ignore_ascii_case(expected) {
            matched_fields.push(field.clone());
        } else {
            mismatches.push(ApplicabilityMismatch {
                field: field.clone(),
                expected: expected.clone(),
                actual: actual.clone(),
            });
        }
    }

    let (decision, reasons) = if requirements.is_empty() {
        (
            ApplicabilityDecision::Unknown,
            vec!["no_declared_requirements".to_string()],
        )
    } else if !mismatches.is_empty() {
        (
            ApplicabilityDecision::Reject,
            vec!["hard_requirement_mismatch".to_string()],
        )
    } else if !invalid_requirement_fields.is_empty()
        || !missing_fields.is_empty()
        || !conflicting_fields.is_empty()
    {
        let mut reasons = Vec::new();
        if !invalid_requirement_fields.is_empty() {
            reasons.push("invalid_declared_requirement".to_string());
        }
        if !missing_fields.is_empty() {
            reasons.push("missing_current_state".to_string());
        }
        if !conflicting_fields.is_empty() {
            reasons.push("conflicting_current_state".to_string());
        }
        (ApplicabilityDecision::Unknown, reasons)
    } else {
        (
            ApplicabilityDecision::Use,
            vec!["all_requirements_satisfied".to_string()],
        )
    };

    ApplicabilityReport {
        record_id: record.id.clone(),
        decision,
        requirements_total: requirements.len(),
        matched_fields,
        missing_fields,
        conflicting_fields,
        mismatches,
        invalid_requirement_fields,
        reasons,
    }
}

fn normalized_values(values: &[String]) -> Vec<String> {
    let mut distinct = BTreeMap::new();
    for value in values.iter().map(|value| value.trim()) {
        if !value.is_empty() {
            distinct
                .entry(value.to_lowercase())
                .or_insert_with(|| value.to_string());
        }
    }
    distinct.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    fn experience(requirements: &[(&str, &str)]) -> Record {
        let mut record = Record::new("Prior experience".into(), Level::Decisions);
        for (field, value) in requirements {
            record.metadata.insert(
                format!("{APPLICABILITY_REQUIRE_PREFIX}{field}"),
                (*value).to_string(),
            );
        }
        record
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
    fn complete_match_is_use() {
        let record = experience(&[("cause", "expired_token"), ("network", "online")]);
        let report = evaluate_applicability(
            &record,
            &context(&[("cause", &["Expired_Token"]), ("network", &["online"])]),
        );
        assert_eq!(report.decision, ApplicabilityDecision::Use);
        assert_eq!(report.matched_fields, vec!["cause", "network"]);
    }

    #[test]
    fn hard_mismatch_is_reject_even_when_another_field_is_missing() {
        let record = experience(&[("cause", "expired_token"), ("network", "online")]);
        let report = evaluate_applicability(&record, &context(&[("cause", &["forbidden"])]));
        assert_eq!(report.decision, ApplicabilityDecision::Reject);
        assert_eq!(report.missing_fields, vec!["network"]);
        assert_eq!(report.mismatches[0].field, "cause");
    }

    #[test]
    fn missing_conflicting_and_unstructured_inputs_abstain() {
        let record = experience(&[("cause", "expired_token"), ("network", "online")]);
        let missing = evaluate_applicability(&record, &context(&[("cause", &["expired_token"])]));
        assert_eq!(missing.decision, ApplicabilityDecision::Unknown);

        let conflicting = evaluate_applicability(
            &record,
            &context(&[
                ("cause", &["expired_token"]),
                ("network", &["online", "offline"]),
            ]),
        );
        assert_eq!(conflicting.decision, ApplicabilityDecision::Unknown);
        assert_eq!(conflicting.conflicting_fields[0].field, "network");

        let unstructured = Record::new("Unstructured experience".into(), Level::Decisions);
        let unknown = evaluate_applicability(&unstructured, &ApplicabilityContext::new());
        assert_eq!(unknown.decision, ApplicabilityDecision::Unknown);
        assert_eq!(unknown.reasons, vec!["no_declared_requirements"]);
    }

    #[test]
    fn duplicate_observations_do_not_create_false_conflicts() {
        let record = experience(&[("network", "online")]);
        let report = evaluate_applicability(
            &record,
            &context(&[("network", &["online", "online", " online ", "ONLINE"])]),
        );
        assert_eq!(report.decision, ApplicabilityDecision::Use);
    }
}
