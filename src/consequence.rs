//! Consequence Unit substrate.
//!
//! A `ConsequenceUnit` is a structured, first-class way to store what happened
//! after an agent or tool acted in the world:
//!
//! situation -> action -> consequence -> trust -> scope -> provenance -> links
//!
//! It intentionally reuses normal `Record` storage so persistence, recall,
//! namespaces, provenance, and graph links keep working without a new storage
//! backend.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::record::Record;

#[cfg(feature = "python")]
use pyo3::prelude::*;

pub const CONSEQUENCE_UNIT_TAG: &str = "consequence-unit";
pub const CONSEQUENCE_SUPPORT_TAG: &str = "consequence-support";
pub const CONSEQUENCE_REFUTE_TAG: &str = "consequence-refute";
pub const CONSEQUENCE_INCONCLUSIVE_TAG: &str = "consequence-inconclusive";

pub const META_KIND: &str = "consequence_unit";
pub const META_SITUATION: &str = "cu_situation";
pub const META_ACTION: &str = "cu_action";
pub const META_CONSEQUENCE: &str = "cu_consequence";
pub const META_TRUST: &str = "cu_trust";
pub const META_SCOPE: &str = "cu_scope";
pub const META_PROVENANCE: &str = "cu_provenance";
pub const META_LINKS: &str = "cu_links";
pub const META_CAPTURED_AT: &str = "cu_captured_at";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(eq, eq_int))]
pub enum ConsequencePolarity {
    Supports,
    Refutes,
    Inconclusive,
}

impl ConsequencePolarity {
    pub fn from_consequence(consequence: &str, trust: i32) -> Self {
        let normalized = consequence.trim().to_ascii_lowercase();
        if trust > 0
            || matches!(
                normalized.as_str(),
                "support" | "supports" | "supported" | "success" | "pass" | "passed" | "ok"
            )
        {
            Self::Supports
        } else if trust < 0
            || matches!(
                normalized.as_str(),
                "refute" | "refutes" | "refuted" | "failure" | "fail" | "failed" | "panic"
            )
        {
            Self::Refutes
        } else {
            Self::Inconclusive
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Supports => "supports",
            Self::Refutes => "refutes",
            Self::Inconclusive => "inconclusive",
        }
    }

    pub fn tag(self) -> &'static str {
        match self {
            Self::Supports => CONSEQUENCE_SUPPORT_TAG,
            Self::Refutes => CONSEQUENCE_REFUTE_TAG,
            Self::Inconclusive => CONSEQUENCE_INCONCLUSIVE_TAG,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(get_all))]
pub struct ConsequenceUnit {
    pub record_id: String,
    pub situation: String,
    pub action: String,
    pub consequence: String,
    pub trust: i32,
    pub scope: Vec<String>,
    pub provenance: Vec<String>,
    pub links: HashMap<String, String>,
    pub namespace: String,
    pub captured_at: f64,
}

impl ConsequenceUnit {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        record_id: String,
        situation: String,
        action: String,
        consequence: String,
        trust: i32,
        scope: Vec<String>,
        provenance: Vec<String>,
        links: HashMap<String, String>,
        namespace: String,
        captured_at: f64,
    ) -> Self {
        Self {
            record_id,
            situation,
            action,
            consequence,
            trust,
            scope,
            provenance,
            links,
            namespace,
            captured_at,
        }
    }

    pub fn polarity(&self) -> ConsequencePolarity {
        ConsequencePolarity::from_consequence(&self.consequence, self.trust)
    }

    pub fn readout(&self) -> String {
        format!(
            "state `{}` action `{}` consequence `{}` trust {} scope [{}]",
            self.situation,
            self.action,
            self.consequence,
            self.trust,
            self.scope.join(", ")
        )
    }

    pub fn to_content(&self) -> String {
        format!(
            "[CONSEQUENCE] situation={} | action={} | consequence={} | trust={} | scope={}",
            self.situation,
            self.action,
            self.consequence,
            self.trust,
            self.scope.join(",")
        )
    }

    pub fn to_tags(&self) -> Vec<String> {
        let mut tags = vec![
            CONSEQUENCE_UNIT_TAG.to_string(),
            "outcome".to_string(),
            self.polarity().tag().to_string(),
        ];
        for item in &self.scope {
            let safe = item.trim();
            if !safe.is_empty() {
                tags.push(format!("scope:{safe}"));
            }
        }
        tags
    }

    pub fn to_metadata(&self) -> HashMap<String, String> {
        let mut meta = HashMap::new();
        meta.insert("kind".into(), META_KIND.into());
        meta.insert(META_SITUATION.into(), self.situation.clone());
        meta.insert(META_ACTION.into(), self.action.clone());
        meta.insert(META_CONSEQUENCE.into(), self.consequence.clone());
        meta.insert(META_TRUST.into(), self.trust.to_string());
        meta.insert(META_SCOPE.into(), self.scope.join("\n"));
        meta.insert(META_PROVENANCE.into(), self.provenance.join("\n"));
        meta.insert(META_CAPTURED_AT.into(), format!("{:.6}", self.captured_at));
        if !self.links.is_empty() {
            if let Ok(encoded) = serde_json::to_string(&self.links) {
                meta.insert(META_LINKS.into(), encoded);
            }
        }
        meta
    }

    pub fn from_record(record: &Record) -> Option<Self> {
        if !record.tags.iter().any(|tag| tag == CONSEQUENCE_UNIT_TAG) {
            return None;
        }
        if record.metadata.get("kind").map(String::as_str) != Some(META_KIND) {
            return None;
        }

        let trust = record
            .metadata
            .get(META_TRUST)
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);
        let scope = split_metadata_list(record.metadata.get(META_SCOPE));
        let provenance = split_metadata_list(record.metadata.get(META_PROVENANCE));
        let links = record
            .metadata
            .get(META_LINKS)
            .and_then(|v| serde_json::from_str::<HashMap<String, String>>(v).ok())
            .unwrap_or_default();
        let captured_at = record
            .metadata
            .get(META_CAPTURED_AT)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(record.created_at);

        Some(Self::new(
            record.id.clone(),
            record
                .metadata
                .get(META_SITUATION)
                .cloned()
                .unwrap_or_default(),
            record
                .metadata
                .get(META_ACTION)
                .cloned()
                .unwrap_or_default(),
            record
                .metadata
                .get(META_CONSEQUENCE)
                .cloned()
                .unwrap_or_default(),
            trust,
            scope,
            provenance,
            links,
            record.namespace.clone(),
            captured_at,
        ))
    }
}

/// A runtime decision derived from the scar-protected consequence verdict for a
/// `(situation, action)` pair. This is the actionable form of a verdict: an
/// agent reads `hint` / `should_block` / `requires_evidence` before acting.
///
/// Field names and the `hint` vocabulary (`avoid` / `prefer` / `verify_first`)
/// are chosen to match what consuming agents expect, so the SDK can serve a
/// `policy_hint` directly instead of every agent re-deriving it from the verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(get_all))]
pub struct ConsequencePolicyHint {
    pub situation: String,
    pub action: String,
    /// One of: `avoid` | `prefer` | `verify_first`.
    pub hint: String,
    /// Human-readable, LLM-free explanation of why this hint was chosen.
    pub reason: String,
    /// `supports` | `refutes` | `inconclusive` — the underlying verdict.
    pub verdict: String,
    pub supports: usize,
    pub refutes: usize,
    /// True when the action has no lived consequence yet (verify before relying).
    pub requires_evidence: bool,
    /// True when a lived refutation says the agent should NOT take this action.
    pub should_block: bool,
    /// True when a refutation survived later supporting frequency (gaslight guard
    /// fired): the world's "no" outranks the model's repeated "yes".
    pub scar: bool,
}

impl ConsequencePolicyHint {
    /// Map a scar-protected verdict into an actionable hint. Deterministic.
    pub fn from_verdict(
        situation: &str,
        action: &str,
        verdict: ConsequencePolarity,
        supports: usize,
        refutes: usize,
    ) -> Self {
        match verdict {
            ConsequencePolarity::Refutes => Self {
                situation: situation.to_string(),
                action: action.to_string(),
                hint: "avoid".to_string(),
                reason: "Prior lived consequence refuted this action in this situation."
                    .to_string(),
                verdict: "refutes".to_string(),
                supports,
                refutes,
                requires_evidence: false,
                should_block: true,
                // A scar is a refutation that survived later supporting frequency.
                scar: refutes >= 1 && supports >= 1,
            },
            ConsequencePolarity::Supports => Self {
                situation: situation.to_string(),
                action: action.to_string(),
                hint: "prefer".to_string(),
                reason: "Prior lived consequence supported this action in this situation."
                    .to_string(),
                verdict: "supports".to_string(),
                supports,
                refutes,
                requires_evidence: false,
                should_block: false,
                scar: false,
            },
            ConsequencePolarity::Inconclusive => Self {
                situation: situation.to_string(),
                action: action.to_string(),
                hint: "verify_first".to_string(),
                reason: "No lived consequence is available; verify before treating this as known."
                    .to_string(),
                verdict: "inconclusive".to_string(),
                supports,
                refutes,
                requires_evidence: true,
                should_block: false,
                scar: false,
            },
        }
    }
}

pub fn now_secs_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn split_metadata_list(value: Option<&String>) -> Vec<String> {
    value
        .map(|raw| {
            raw.lines()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
