//! Deterministic, bounded hot context for agent session continuity.
//!
//! A context capsule is a read-only projection over existing Aura records. It
//! is not another memory store and does not activate, promote, or rewrite the
//! records it selects.

use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::evidence::{AnswerPermission, VerificationStatus};
use crate::levels::Level;
use crate::record::{Record, RouteStateClass};

const ENTRY_OVERHEAD_TOKENS: usize = 16;
const MIN_ENTRY_CONTENT_TOKENS: usize = 8;
const MAX_TOKEN_BUDGET: usize = 32_768;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextCategory {
    RefutationScar,
    EvidenceDebt,
    ActiveGoal,
    Contradiction,
    Outcome,
    Decision,
    Identity,
    Domain,
    PurposeRelevant,
}

impl ContextCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RefutationScar => "refutation_scar",
            Self::EvidenceDebt => "evidence_debt",
            Self::ActiveGoal => "active_goal",
            Self::Contradiction => "contradiction",
            Self::Outcome => "outcome",
            Self::Decision => "decision",
            Self::Identity => "identity",
            Self::Domain => "domain",
            Self::PurposeRelevant => "purpose_relevant",
        }
    }

    fn priority(self) -> i64 {
        match self {
            Self::RefutationScar => 1_000,
            Self::EvidenceDebt => 900,
            Self::ActiveGoal => 800,
            Self::Contradiction => 750,
            Self::Outcome => 650,
            Self::Decision => 600,
            Self::Identity => 550,
            Self::Domain => 500,
            Self::PurposeRelevant => 400,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextCapsuleEntry {
    pub record_id: String,
    pub category: ContextCategory,
    pub content: String,
    pub source_type: String,
    pub semantic_type: String,
    pub level: Level,
    pub confidence: f32,
    pub strength: f32,
    pub salience: f32,
    pub estimated_tokens: usize,
    pub selection_reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextCapsule {
    pub namespace: String,
    pub purpose: String,
    pub token_budget: usize,
    pub estimated_tokens: usize,
    pub source_record_count: usize,
    pub entries: Vec<ContextCapsuleEntry>,
    pub omitted_count: usize,
    pub refutation_count: usize,
    pub evidence_debt_count: usize,
    pub contradiction_count: usize,
    /// SHA-256 over deterministic capsule content (the hash field excluded).
    pub capsule_hash: String,
}

/// Metrics for an opt-in loss-aware context capsule build.
///
/// Aura never rewrites the underlying records. `original_equivalent_tokens`
/// estimates the uncompressed size of the records selected by the compacted
/// capsule, while `compacted_tokens` is the actual bounded capsule estimate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextCompactionReport {
    pub baseline_entry_count: usize,
    pub output_entry_count: usize,
    pub additional_entry_count: usize,
    pub original_equivalent_tokens: usize,
    pub compacted_tokens: usize,
    pub saved_tokens: usize,
    pub reduction_ratio: f32,
    pub transformed_entry_count: usize,
    pub protected_entry_count: usize,
    pub originals_unchanged: bool,
}

/// A compacted context capsule plus auditable compaction metrics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompactedContextCapsule {
    pub capsule: ContextCapsule,
    pub compaction: ContextCompactionReport,
}

#[derive(Debug)]
struct Candidate<'a> {
    record: &'a Record,
    category: ContextCategory,
    priority_score: i64,
    reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BuildMode {
    Original,
    LossAware,
}

#[derive(Debug, Default)]
struct BuildDiagnostics {
    original_equivalent_tokens: usize,
    transformed_entry_count: usize,
    protected_entry_count: usize,
}

/// Build a deterministic, token-bounded projection for one namespace.
pub fn build_context_capsule<'a>(
    records: impl IntoIterator<Item = &'a Record>,
    namespace: &str,
    purpose: &str,
    token_budget: usize,
) -> ContextCapsule {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    build_context_capsule_at(records, namespace, purpose, token_budget, now)
}

/// Build an opt-in loss-aware context capsule without mutating stored memory.
pub fn build_compacted_context_capsule<'a>(
    records: impl IntoIterator<Item = &'a Record>,
    namespace: &str,
    purpose: &str,
    token_budget: usize,
) -> CompactedContextCapsule {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    build_compacted_context_capsule_at(records, namespace, purpose, token_budget, now)
}

/// Build a deterministic context capsule for records valid at `valid_at`.
pub fn build_context_capsule_at<'a>(
    records: impl IntoIterator<Item = &'a Record>,
    namespace: &str,
    purpose: &str,
    token_budget: usize,
    valid_at: f64,
) -> ContextCapsule {
    build_context_capsule_at_mode(
        records,
        namespace,
        purpose,
        token_budget,
        valid_at,
        BuildMode::Original,
    )
    .0
}

/// Build a loss-aware context capsule for one business-time instant.
pub fn build_compacted_context_capsule_at<'a>(
    records: impl IntoIterator<Item = &'a Record>,
    namespace: &str,
    purpose: &str,
    token_budget: usize,
    valid_at: f64,
) -> CompactedContextCapsule {
    let records: Vec<&Record> = records.into_iter().collect();
    let (baseline, _) = build_context_capsule_at_mode(
        records.iter().copied(),
        namespace,
        purpose,
        token_budget,
        valid_at,
        BuildMode::Original,
    );
    let (capsule, diagnostics) = build_context_capsule_at_mode(
        records,
        namespace,
        purpose,
        token_budget,
        valid_at,
        BuildMode::LossAware,
    );
    let saved_tokens = diagnostics
        .original_equivalent_tokens
        .saturating_sub(capsule.estimated_tokens);
    let reduction_ratio = if diagnostics.original_equivalent_tokens == 0 {
        0.0
    } else {
        saved_tokens as f32 / diagnostics.original_equivalent_tokens as f32
    };
    let compaction = ContextCompactionReport {
        baseline_entry_count: baseline.entries.len(),
        output_entry_count: capsule.entries.len(),
        additional_entry_count: capsule.entries.len().saturating_sub(baseline.entries.len()),
        original_equivalent_tokens: diagnostics.original_equivalent_tokens,
        compacted_tokens: capsule.estimated_tokens,
        saved_tokens,
        reduction_ratio,
        transformed_entry_count: diagnostics.transformed_entry_count,
        protected_entry_count: diagnostics.protected_entry_count,
        originals_unchanged: true,
    };
    CompactedContextCapsule {
        capsule,
        compaction,
    }
}

fn build_context_capsule_at_mode<'a>(
    records: impl IntoIterator<Item = &'a Record>,
    namespace: &str,
    purpose: &str,
    token_budget: usize,
    valid_at: f64,
    mode: BuildMode,
) -> (ContextCapsule, BuildDiagnostics) {
    let token_budget = token_budget.clamp(1, MAX_TOKEN_BUDGET);
    let purpose_terms = normalized_terms(purpose);
    let namespace_records: Vec<&Record> = records
        .into_iter()
        .filter(|record| {
            record.namespace == namespace
                && record.is_valid_at(valid_at)
                && crate::acl::evaluate(record, &crate::acl::AclContext::default()).allowed
        })
        .collect();
    let source_record_count = namespace_records.len();

    let mut candidates: Vec<Candidate<'_>> = namespace_records
        .iter()
        .filter_map(|record| classify(record, &purpose_terms))
        .collect();
    candidates.sort_by(|left, right| {
        right
            .priority_score
            .cmp(&left.priority_score)
            .then_with(|| {
                right
                    .record
                    .created_at
                    .partial_cmp(&left.record.created_at)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.record.id.cmp(&right.record.id))
    });

    let refutation_count = candidates
        .iter()
        .filter(|item| item.category == ContextCategory::RefutationScar)
        .count();
    let evidence_debt_count = candidates
        .iter()
        .filter(|item| item.category == ContextCategory::EvidenceDebt)
        .count();
    let contradiction_count = candidates
        .iter()
        .filter(|item| item.category == ContextCategory::Contradiction)
        .count();

    let mut remaining = token_budget;
    let mut entries = Vec::new();
    let mut diagnostics = BuildDiagnostics::default();
    for candidate in &candidates {
        if remaining <= ENTRY_OVERHEAD_TOKENS + MIN_ENTRY_CONTENT_TOKENS {
            break;
        }
        let (prepared_content, protected) = match mode {
            BuildMode::Original => (candidate.record.content.clone(), false),
            BuildMode::LossAware => compact_record_content(candidate.record, candidate.category),
        };
        let max_content_tokens = remaining - ENTRY_OVERHEAD_TOKENS;
        let content = truncate_to_estimated_tokens(&prepared_content, max_content_tokens);
        let estimated_tokens = ENTRY_OVERHEAD_TOKENS + estimate_tokens(&content);
        if content.trim().is_empty() || estimated_tokens > remaining {
            continue;
        }
        if mode == BuildMode::LossAware {
            diagnostics.original_equivalent_tokens +=
                ENTRY_OVERHEAD_TOKENS + estimate_tokens(&candidate.record.content);
            diagnostics.transformed_entry_count +=
                usize::from(prepared_content != candidate.record.content);
            diagnostics.protected_entry_count += usize::from(protected);
        }
        remaining -= estimated_tokens;
        entries.push(ContextCapsuleEntry {
            record_id: candidate.record.id.clone(),
            category: candidate.category,
            content,
            source_type: candidate.record.source_type.clone(),
            semantic_type: candidate.record.semantic_type.clone(),
            level: candidate.record.level,
            confidence: finite_or_zero(candidate.record.confidence),
            strength: finite_or_zero(candidate.record.strength),
            salience: finite_or_zero(candidate.record.salience),
            estimated_tokens,
            selection_reasons: candidate.reasons.clone(),
        });
    }

    let estimated_tokens = token_budget - remaining;
    let omitted_count = candidates.len().saturating_sub(entries.len());
    let hash_payload = serde_json::to_vec(&(
        namespace,
        purpose,
        token_budget,
        estimated_tokens,
        source_record_count,
        &entries,
        omitted_count,
        refutation_count,
        evidence_debt_count,
        contradiction_count,
    ))
    .unwrap_or_default();
    let capsule_hash = hex::encode(Sha256::digest(hash_payload));

    (
        ContextCapsule {
            namespace: namespace.to_string(),
            purpose: purpose.to_string(),
            token_budget,
            estimated_tokens,
            source_record_count,
            entries,
            omitted_count,
            refutation_count,
            evidence_debt_count,
            contradiction_count,
            capsule_hash,
        },
        diagnostics,
    )
}

fn compact_record_content(record: &Record, category: ContextCategory) -> (String, bool) {
    // Active goals are action-bearing instructions. The local-model A/B showed
    // that removing apparently redundant emphasis could change a small model's
    // answer even when every fact remained present. Structured payloads must
    // likewise remain byte-for-byte intact.
    // text/* also includes source code, HTML and tabular payloads.
    let natural_text = matches!(
        record.content_type.as_str(),
        "text" | "text/plain" | "text/markdown"
    );
    if category == ContextCategory::ActiveGoal || !natural_text {
        return (record.content.clone(), true);
    }
    let compacted = compact_natural_text(&record.content);
    if compacted.trim().is_empty() && !record.content.trim().is_empty() {
        (record.content.clone(), true)
    } else {
        (compacted, false)
    }
}

fn compact_natural_text(input: &str) -> String {
    let mut seen = BTreeSet::new();
    let mut kept = Vec::new();
    for unit in split_text_units(input) {
        let normalized = normalize_whitespace(&unit);
        if normalized.is_empty() {
            continue;
        }
        let stripped = strip_boilerplate_prefix(&normalized);
        if stripped.is_empty() {
            continue;
        }
        // Case can distinguish identifiers, error codes and quoted values.
        if seen.insert(stripped.clone()) {
            kept.push(stripped);
        }
    }
    kept.join(" ")
}

fn split_text_units(input: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut current = String::new();
    let mut characters = input.chars().peekable();
    while let Some(character) = characters.next() {
        current.push(character);
        let punctuation_boundary = matches!(character, '.' | '!' | '?' | ';')
            && characters.peek().is_none_or(|next| next.is_whitespace());
        if character == '\n' || punctuation_boundary {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                units.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        units.push(trimmed.to_string());
    }
    units
}

fn strip_boilerplate_prefix(unit: &str) -> String {
    const PREFIXES: &[&str] = &[
        "as previously mentioned, ",
        "for completeness, ",
        "in other words, ",
        "it is important to note that ",
    ];
    for prefix in PREFIXES {
        if unit
            .get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
        {
            return unit[prefix.len()..].trim().to_string();
        }
    }
    unit.to_string()
}

fn normalize_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn classify<'a>(record: &'a Record, purpose_terms: &BTreeSet<String>) -> Option<Candidate<'a>> {
    let answer_blocked = record
        .metadata
        .get("answer_permission")
        .and_then(|value| AnswerPermission::parse(value))
        == Some(AnswerPermission::Blocked);
    let admission_blocked = record
        .metadata
        .get("admission")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("block"));
    let verification_superseded = record
        .metadata
        .get("verification_status")
        .and_then(|value| VerificationStatus::parse(value))
        == Some(VerificationStatus::Superseded);
    if answer_blocked
        || admission_blocked
        || verification_superseded
        // Legacy superseded records have no validity boundary and must remain
        // blocked. Temporal supersede records are admitted until valid_until;
        // the caller's is_valid_at(valid_at) filter enforces that boundary.
        || (record.metadata.contains_key("superseded_by") && record.valid_until.is_none())
    {
        return None;
    }

    let record_terms = normalized_terms(&format!(
        "{} {} {}",
        record.content,
        record.tags.join(" "),
        record.semantic_type
    ));
    let purpose_overlap = purpose_terms.intersection(&record_terms).count();
    let has_tag = |expected: &[&str]| {
        record
            .tags
            .iter()
            .any(|tag| expected.iter().any(|item| tag == item))
    };
    let inactive = record
        .metadata
        .get("status")
        .or_else(|| record.metadata.get("project_status"))
        .is_some_and(|status| {
            matches!(
                status.to_ascii_lowercase().as_str(),
                "completed" | "cancelled" | "closed" | "done"
            )
        });

    let category = match record.route_state_class() {
        RouteStateClass::Refuted => ContextCategory::RefutationScar,
        RouteStateClass::EvidenceDebt => ContextCategory::EvidenceDebt,
        _ if !inactive
            && has_tag(&[
                "mission",
                "goal",
                "task",
                "todo",
                "scheduled-task",
                "active-goal",
            ]) =>
        {
            ContextCategory::ActiveGoal
        }
        _ if record.semantic_type == "contradiction" || has_tag(&["contradiction"]) => {
            ContextCategory::Contradiction
        }
        _ if has_tag(&[
            "outcome",
            "failure",
            "outcome-failure",
            "autonomous-outcome",
        ]) =>
        {
            ContextCategory::Outcome
        }
        _ if record.semantic_type == "decision" || record.level == Level::Decisions => {
            ContextCategory::Decision
        }
        _ if record.level == Level::Identity => ContextCategory::Identity,
        _ if record.level == Level::Domain => ContextCategory::Domain,
        _ if purpose_overlap > 0 => ContextCategory::PurposeRelevant,
        _ => return None,
    };

    let mut reasons = vec![category.as_str().to_string()];
    if purpose_overlap > 0 {
        reasons.push(format!("purpose_overlap:{purpose_overlap}"));
    }
    if record.salience > 0.0 {
        reasons.push(format!("salience:{:.3}", record.salience));
    }
    let salience = finite_or_zero(record.salience).clamp(0.0, 1.0);
    let confidence = finite_or_zero(record.confidence).clamp(0.0, 1.0);
    let priority_score = category.priority() * 1_000_000
        + (purpose_overlap.min(999) as i64) * 10_000
        + (salience * 1_000.0).round() as i64 * 10
        + (confidence * 1_000.0).round() as i64;
    Some(Candidate {
        record,
        category,
        priority_score,
        reasons,
    })
}

fn normalized_terms(value: &str) -> BTreeSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|part| part.chars().count() >= 2)
        .map(|part| part.to_lowercase())
        .collect()
}

fn estimate_tokens(value: &str) -> usize {
    value.chars().count().div_ceil(4).max(1)
}

fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn truncate_to_estimated_tokens(value: &str, max_tokens: usize) -> String {
    let max_chars = max_tokens.saturating_mul(4);
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let mut output: String = value.chars().take(keep).collect();
    output.push('…');
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepush_compaction_preserves_case_sensitive_codes() {
        let text = "The code is AbC123. The code is abc123. The code is AbC123.";
        assert_eq!(
            compact_natural_text(text),
            "The code is AbC123. The code is abc123."
        );
    }

    #[test]
    fn prepush_compaction_preserves_typed_source_code() {
        let mut rec = Record::new(
            "print('First')\nprint('Second')\nprint('First')".into(),
            Level::Domain,
        );
        rec.content_type = "text/x-python".into();
        let (content, protected) = compact_record_content(&rec, ContextCategory::Domain);
        assert!(protected);
        assert_eq!(content, rec.content);
    }

    fn record(id: &str, content: &str, namespace: &str, tags: &[&str]) -> Record {
        let mut record = Record::new(content.to_string(), Level::Working);
        record.id = id.to_string();
        record.namespace = namespace.to_string();
        record.tags = tags.iter().map(|value| value.to_string()).collect();
        record
    }

    #[test]
    fn capsule_is_deterministic_and_namespace_isolated() {
        let records = vec![
            record("goal", "Ship the institute search", "remy", &["goal"]),
            record("other", "Private unrelated goal", "other", &["goal"]),
        ];
        let first = build_context_capsule(&records, "remy", "continue institute work", 128);
        let second = build_context_capsule(&records, "remy", "continue institute work", 128);
        assert_eq!(first, second);
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.entries[0].record_id, "goal");
    }

    #[test]
    fn refutation_scar_precedes_active_goal() {
        let mut scar = record(
            "scar",
            "Skipping source verification caused a false answer",
            "default",
            &[crate::consequence::CONSEQUENCE_REFUTE_TAG],
        );
        scar.strength = 0.0;
        let goal = record("goal", "Answer the next question", "default", &["goal"]);
        let capsule = build_context_capsule([&goal, &scar], "default", "answer", 256);
        assert_eq!(capsule.entries[0].record_id, "scar");
        assert_eq!(capsule.refutation_count, 1);
    }

    #[test]
    fn capsule_respects_budget_and_does_not_activate_records() {
        let mut goal = record(
            "goal",
            &"important context ".repeat(100),
            "default",
            &["goal"],
        );
        goal.activation_count = 7;
        let before = goal.activation_count;
        let capsule = build_context_capsule([&goal], "default", "context", 40);
        assert!(capsule.estimated_tokens <= 40);
        assert_eq!(goal.activation_count, before);
        assert!(capsule.entries[0].content.ends_with('…'));
    }

    #[test]
    fn blocked_and_superseded_records_are_omitted() {
        let mut blocked = record("blocked", "Do not surface", "default", &["goal"]);
        blocked
            .metadata
            .insert("answer_permission".into(), "blocked".into());
        let mut old = record("old", "Old plan", "default", &["goal"]);
        old.metadata.insert("superseded_by".into(), "new".into());
        let capsule = build_context_capsule([&blocked, &old], "default", "plan", 128);
        assert!(capsule.entries.is_empty());
    }

    #[test]
    fn blocked_and_superseded_metadata_is_normalized_before_filtering() {
        let mut blocked = record("blocked", "Do not surface", "default", &["goal"]);
        blocked
            .metadata
            .insert("answer_permission".into(), "  BLOCKED  ".into());
        let mut denied = record("denied", "Also hidden", "default", &["goal"]);
        denied.metadata.insert("admission".into(), "BLOCK".into());
        let mut superseded = record("old", "Old plan", "default", &["goal"]);
        superseded
            .metadata
            .insert("verification_status".into(), "Superseded".into());

        let capsule =
            build_context_capsule([&blocked, &denied, &superseded], "default", "plan", 128);
        assert!(capsule.entries.is_empty());
    }

    #[test]
    fn capsule_at_filters_by_business_time() {
        let mut old = record("old", "Use legacy deployment", "default", &["goal"]);
        old.set_validity(Some(100.0), Some(200.0)).unwrap();
        old.metadata.insert("superseded_by".into(), "new".into());
        let mut new = record("new", "Use current deployment", "default", &["goal"]);
        new.set_validity(Some(200.0), None).unwrap();

        let historical =
            build_context_capsule_at([&old, &new], "default", "deployment", 128, 150.0);
        assert_eq!(historical.entries.len(), 1);
        assert_eq!(historical.entries[0].record_id, "old");

        let current = build_context_capsule_at([&old, &new], "default", "deployment", 128, 200.0);
        assert_eq!(current.entries.len(), 1);
        assert_eq!(current.entries[0].record_id, "new");
    }

    #[test]
    fn loss_aware_capsule_fits_more_relevant_records_without_mutation() {
        let records: Vec<Record> = (0..10)
            .map(|index| {
                record(
                    &format!("memory-{index}"),
                    &format!(
                        "Memory item {index} concerns deployment. Deployment is approved. \
                         As previously mentioned, deployment is approved. \
                         Deployment is approved."
                    ),
                    "default",
                    &[],
                )
            })
            .collect();
        let originals: Vec<String> = records.iter().map(|item| item.content.clone()).collect();
        let baseline =
            build_context_capsule_at(&records, "default", "deployment", 200, 1_800_000_000.0);
        let compacted = build_compacted_context_capsule_at(
            &records,
            "default",
            "deployment",
            200,
            1_800_000_000.0,
        );

        assert!(compacted.capsule.entries.len() > baseline.entries.len());
        assert!(compacted.compaction.additional_entry_count > 0);
        assert!(compacted.compaction.saved_tokens > 0);
        assert!(compacted.compaction.reduction_ratio > 0.0);
        assert!(compacted.compaction.transformed_entry_count > 0);
        assert!(compacted.compaction.originals_unchanged);
        assert_eq!(
            records
                .iter()
                .map(|item| item.content.clone())
                .collect::<Vec<_>>(),
            originals
        );
    }

    #[test]
    fn loss_aware_capsule_protects_active_goals_and_structured_payloads() {
        let goal_content = "Active goal GOAL-31. Prepare release 1.59.0 after all tests pass. \
                            Prepare release 1.59.0 after all tests pass.";
        let goal = record("goal", goal_content, "default", &["goal"]);
        let json_content = r#"{"decision":"allow","decision":"allow"}"#;
        let mut json = record("json", json_content, "default", &[]);
        json.content_type = "json".to_string();

        let compacted = build_compacted_context_capsule_at(
            [&goal, &json],
            "default",
            "goal decision",
            512,
            1_800_000_000.0,
        );
        let by_id = |id: &str| {
            compacted
                .capsule
                .entries
                .iter()
                .find(|entry| entry.record_id == id)
                .map(|entry| entry.content.as_str())
        };

        assert_eq!(by_id("goal"), Some(goal_content));
        assert_eq!(by_id("json"), Some(json_content));
        assert_eq!(compacted.compaction.protected_entry_count, 2);
        assert_eq!(goal.content, goal_content);
    }

    #[test]
    fn natural_text_compaction_preserves_urls_decimals_versions_and_distinctions() {
        let input = "Source: https://example.com/report.json. Confidence: 0.54. \
                     Version 1.5 is allowed. Version 15 is allowed. \
                     As previously mentioned, Version 1.5 is allowed.";
        let compacted = compact_natural_text(input);

        assert!(compacted.contains("https://example.com/report.json"));
        assert!(compacted.contains("Confidence: 0.54"));
        assert!(compacted.contains("Version 1.5 is allowed"));
        assert!(compacted.contains("Version 15 is allowed"));
        assert_eq!(compacted.matches("ersion 1.5 is allowed").count(), 1);
    }
}
