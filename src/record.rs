//! CognitiveRecord — the unified memory unit.
//!
//! Combines metadata from both aura-memory (SDR-based) and aura-cognitive
//! (hierarchical decay) into a single struct exposed via PyO3.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::levels::Level;

#[cfg(feature = "python")]
use pyo3::prelude::*;

/// Consequence route-state class of a record, used by route-state-stratified
/// decay. Ordered weakest→strongest by how long the memory should be retained;
/// `Refuted` is special-cased as an eternal scar (never field-decays) despite
/// sitting at the top of the ordinal scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass(eq, eq_int))]
pub enum RouteStateClass {
    /// No lived consequence — a plain candidate. Decays fastest.
    Candidate,
    /// Open evidence-debt (`consequence-inconclusive`). Decays slowly.
    EvidenceDebt,
    /// World-confirmed (`consequence-support`). Retained longest.
    Confirmed,
    /// World-refuted (`consequence-refute`) — a scar. Never field-decays.
    Refuted,
}

/// A single cognitive memory record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass)]
pub struct Record {
    /// Unique identifier (12-char hex).
    pub id: String,
    /// Memory content text.
    pub content: String,
    /// Cognitive hierarchy level.
    pub level: Level,
    /// Activation strength (0.0–1.0). Decays over time.
    pub strength: f32,
    /// Number of times this record has been activated (recalled).
    pub activation_count: u32,
    /// Unix timestamp of creation.
    pub created_at: f64,
    /// Unix timestamp of last activation.
    pub last_activated: f64,
    /// Business-time instant from which this record is valid (Unix seconds).
    /// `None` means the record has no lower validity bound.
    #[serde(default)]
    pub valid_from: Option<f64>,
    /// Business-time instant at which this record stops being valid (Unix seconds).
    /// Validity is half-open: `[valid_from, valid_until)`. `None` means unbounded.
    #[serde(default)]
    pub valid_until: Option<f64>,
    /// System-time instant at which Aura recorded that this version was superseded.
    /// This is distinct from `valid_until`, which describes business time.
    #[serde(default)]
    pub superseded_at: Option<f64>,
    /// Classification tags.
    pub tags: Vec<String>,
    /// Bidirectional connections to other records (id → weight).
    pub connections: HashMap<String, f32>,
    /// Connection relationship types (id → type).
    /// Types: "causal", "reflective", "associative", "coactivation", or custom.
    #[serde(default)]
    pub connection_types: HashMap<String, String>,
    /// Content type: "text", "code", "json", "image_ref".
    pub content_type: String,
    /// Type-specific metadata.
    pub metadata: HashMap<String, String>,
    /// Link to aura-memory SDR engine record ID.
    pub aura_id: Option<String>,
    /// Causal parent record ID (for decision rationale chains).
    pub caused_by_id: Option<String>,
    /// Isolation namespace. Records in different namespaces are invisible to each
    /// other during recall/search unless explicitly requested.
    /// Default: "default". Empty string is NOT valid.
    #[serde(default = "default_namespace")]
    pub namespace: String,
    /// How the data was obtained — epistemological provenance.
    /// Values: "recorded" (user interaction), "retrieved" (external source),
    /// "inferred" (LLM reasoning), "generated" (agent-created).
    /// Default: "recorded".
    #[serde(default = "default_source_type")]
    pub source_type: String,
    /// Semantic classification of the record's cognitive role.
    /// Values: "fact" (knowledge), "decision" (choice + rationale),
    /// "trend" (pattern/repeated observation), "serendipity" (cross-domain link),
    /// "preference" (user style/taste), "contradiction" (detected conflict).
    /// Default: "fact".
    #[serde(default = "default_semantic_type")]
    pub semantic_type: String,
    /// Activation velocity — exponential moving average of activation rate.
    /// Updated on each activate() call. Used for trending detection.
    /// Range: 0.0+ (higher = more actively trending). Default: 0.0.
    #[serde(default)]
    pub activation_velocity: f32,
    /// Durable importance weighting independent from raw access frequency.
    /// Used for bounded significance-aware ranking and preservation surfaces.
    /// Range: 0.0–1.0. Default: 0.0.
    #[serde(default)]
    pub salience: f32,

    // ── Epistemic fields (Belief layer support) ──
    /// Epistemic confidence — how reliable this record is.
    /// Initialized from source_type: recorded=0.90, retrieved=0.75,
    /// inferred=0.60, generated=0.50. Range: 0.0–1.0.
    #[serde(default = "default_confidence")]
    pub confidence: f32,

    /// Number of independent confirming neighbors (records that support
    /// the same claim via causal/associative connections).
    #[serde(default)]
    pub support_mass: u32,

    /// Number of conflicting neighbors (records that contradict this one).
    #[serde(default)]
    pub conflict_mass: u32,

    /// Truth-instability — EMA of epistemic state changes
    /// (confidence flips, conflict arrivals, level changes).
    /// Higher = less stable epistemically. Range: 0.0–1.0.
    #[serde(default)]
    pub volatility: f32,
}

/// Default namespace for records.
pub const DEFAULT_NAMESPACE: &str = "default";

/// Default source type for records (user interaction).
pub const DEFAULT_SOURCE_TYPE: &str = "recorded";

/// Valid epistemological source types.
pub const VALID_SOURCE_TYPES: &[&str] = &["recorded", "retrieved", "inferred", "generated"];

/// Default semantic type for records.
pub const DEFAULT_SEMANTIC_TYPE: &str = "fact";

/// Valid semantic types for cognitive classification.
pub const VALID_SEMANTIC_TYPES: &[&str] = &[
    "fact",          // Knowledge, information
    "decision",      // Choice + rationale
    "trend",         // Repeated pattern or observation
    "serendipity",   // Cross-domain unexpected connection
    "preference",    // User style, taste, habit
    "contradiction", // Detected conflict between records
];

/// Automatic promotion is paused once epistemic volatility reaches this
/// level. This matches the existing high-volatility review threshold used by
/// Aura's governance surfaces.
pub const AUTO_PROMOTION_VOLATILITY_LIMIT: f32 = 0.20;

/// A stable, machine-readable reason why automatic promotion was denied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromotionBlockReason {
    InsufficientActivation,
    InsufficientStrength,
    AlreadyIdentity,
    NotCurrentlyValid,
    ContradictionRecord,
    ConflictingEvidence,
    HighVolatility,
    IdentityEvidenceThreshold,
}

impl PromotionBlockReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InsufficientActivation => "insufficient_activation",
            Self::InsufficientStrength => "insufficient_strength",
            Self::AlreadyIdentity => "already_identity",
            Self::NotCurrentlyValid => "not_currently_valid",
            Self::ContradictionRecord => "contradiction_record",
            Self::ConflictingEvidence => "conflicting_evidence",
            Self::HighVolatility => "high_volatility",
            Self::IdentityEvidenceThreshold => "identity_evidence_threshold",
        }
    }
}

fn default_namespace() -> String {
    DEFAULT_NAMESPACE.to_string()
}

fn default_source_type() -> String {
    DEFAULT_SOURCE_TYPE.to_string()
}

fn default_semantic_type() -> String {
    DEFAULT_SEMANTIC_TYPE.to_string()
}

/// Default confidence for deserialization (assumes "recorded" source).
fn default_confidence() -> f32 {
    0.90
}

impl Record {
    /// Create a new record with defaults.
    pub fn new(content: String, level: Level) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        let id = Self::generate_id();

        Self {
            id,
            content,
            level,
            strength: 1.0,
            activation_count: 0,
            created_at: now,
            last_activated: now,
            valid_from: None,
            valid_until: None,
            superseded_at: None,
            tags: Vec::new(),
            connections: HashMap::new(),
            connection_types: HashMap::new(),
            content_type: "text".to_string(),
            metadata: HashMap::new(),
            aura_id: None,
            caused_by_id: None,
            namespace: DEFAULT_NAMESPACE.to_string(),
            source_type: DEFAULT_SOURCE_TYPE.to_string(),
            semantic_type: DEFAULT_SEMANTIC_TYPE.to_string(),
            activation_velocity: 0.0,
            salience: 0.0,
            confidence: Self::default_confidence_for_source(DEFAULT_SOURCE_TYPE),
            support_mass: 0,
            conflict_mass: 0,
            volatility: 0.0,
        }
    }

    /// Generate a 12-char hex ID.
    pub fn generate_id() -> String {
        uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
    }

    /// Composite importance score (0.0–1.0+).
    ///
    /// Formula: strength(40%) + level(25%) + connections(20%) + activations(15%)
    /// + bounded salience hint (10%).
    pub fn importance(&self) -> f32 {
        let level_score = self.level.value() as f32 / 4.0;
        let conn_score = (self.connections.len() as f32 / 50.0).min(1.0);
        let act_score = (self.activation_count as f32 / 20.0).min(1.0);

        0.40 * self.strength
            + 0.25 * level_score
            + 0.20 * conn_score
            + 0.15 * act_score
            + 0.10 * self.salience.clamp(0.0, 1.0)
    }

    /// Whether this record is business-time valid at `timestamp`.
    ///
    /// Validity uses half-open intervals: `valid_from <= timestamp < valid_until`.
    /// Unbounded legacy records remain valid at every finite timestamp.
    pub fn is_valid_at(&self, timestamp: f64) -> bool {
        if !timestamp.is_finite() {
            return false;
        }
        if self
            .valid_from
            .is_some_and(|valid_from| !valid_from.is_finite() || timestamp < valid_from)
        {
            return false;
        }
        if self
            .valid_until
            .is_some_and(|valid_until| !valid_until.is_finite() || timestamp >= valid_until)
        {
            return false;
        }
        true
    }

    /// Validate and assign a business-time validity interval.
    pub fn set_validity(
        &mut self,
        valid_from: Option<f64>,
        valid_until: Option<f64>,
    ) -> Result<(), String> {
        if valid_from.is_some_and(|value| !value.is_finite()) {
            return Err("valid_from must be a finite Unix timestamp".to_string());
        }
        if valid_until.is_some_and(|value| !value.is_finite()) {
            return Err("valid_until must be a finite Unix timestamp".to_string());
        }
        if let (Some(start), Some(end)) = (valid_from, valid_until) {
            if start >= end {
                return Err("valid_from must be earlier than valid_until".to_string());
            }
        }
        self.valid_from = valid_from;
        self.valid_until = valid_until;
        Ok(())
    }

    /// Activate this record (boost strength, update timestamp, update velocity).
    pub fn activate(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        // Update activation velocity via EMA.
        // Instantaneous rate = 1/gap_days. EMA alpha = 0.3.
        let gap_days = ((now - self.last_activated) / 86400.0).max(0.001);
        let instant_rate = (1.0 / gap_days as f32).min(100.0); // cap for numerical safety
        const EMA_ALPHA: f32 = 0.3;
        self.activation_velocity =
            EMA_ALPHA * instant_rate + (1.0 - EMA_ALPHA) * self.activation_velocity;

        self.strength = (self.strength + 0.2).min(1.0);
        self.activation_count += 1;
        self.last_activated = now;
    }

    /// Apply daily decay based on level and semantic type.
    ///
    /// Uses adaptive decay: rate interpolates from base toward 0.999
    /// as activation_count grows (ceiling effect for frequently used records).
    /// Retention is driven by Level (Identity=0.99 .. Working=0.80) and activation frequency.
    /// semantic_type does not influence decay — Level already encodes information importance.
    /// Salience adds only a bounded retention bias.
    pub fn apply_decay(&mut self) {
        let base_rate = self.level.decay_rate();
        let ceiling_factor = (self.activation_count as f32 / 10.0).min(1.0);
        let activation_rate = (base_rate + (0.999 - base_rate) * ceiling_factor).min(0.999);
        let salience_bias = 0.03 * self.salience.clamp(0.0, 1.0);
        let effective_rate = (activation_rate + salience_bias).min(0.999);

        self.strength *= effective_rate;
    }

    /// Whether this record is still alive (not archived).
    pub fn is_alive(&self) -> bool {
        self.strength >= 0.05
    }

    /// Consequence route-state class of this record, read from its tags.
    ///
    /// This is the axis that route-state-stratified decay reads INSTEAD of
    /// access frequency. A `consequence-refute` tag is a scar; `consequence-
    /// support` is confirmed; `consequence-inconclusive` is open evidence-debt;
    /// anything else is a plain candidate.
    pub fn route_state_class(&self) -> RouteStateClass {
        let mut has_support = false;
        let mut has_debt = false;
        for tag in &self.tags {
            match tag.as_str() {
                crate::consequence::CONSEQUENCE_REFUTE_TAG => return RouteStateClass::Refuted,
                crate::consequence::CONSEQUENCE_SUPPORT_TAG => has_support = true,
                crate::consequence::CONSEQUENCE_INCONCLUSIVE_TAG => has_debt = true,
                _ => {}
            }
        }
        if has_support {
            RouteStateClass::Confirmed
        } else if has_debt {
            RouteStateClass::EvidenceDebt
        } else {
            RouteStateClass::Candidate
        }
    }

    /// Apply ONE route-state-stratified decay tick to `strength`.
    ///
    /// Unlike [`apply_decay`], this reads the record's [`RouteStateClass`], NOT
    /// its access frequency. The proven contract (Aura-clean decay kill-test):
    ///
    ///   * `Refuted` (scar) and identity-anchored: rate 0.0 — never field-decays.
    ///   * `Confirmed <= EvidenceDebt <= Candidate` — confirmed survives longest,
    ///     a never-confirmed candidate decays fastest, REGARDLESS of how many
    ///     times it was accessed.
    ///
    /// This is multiplicative on strength so it composes with the existing
    /// tier/archival machinery; the key change is *what* sets the rate.
    pub fn apply_route_state_decay(&mut self) {
        let retention = match self.route_state_class() {
            // identity is structurally anchored; refuted is an eternal scar.
            _ if self.level >= Level::Identity => 1.0,
            RouteStateClass::Refuted => 1.0,
            RouteStateClass::Confirmed => 0.98,
            RouteStateClass::EvidenceDebt => 0.90,
            RouteStateClass::Candidate => 0.80,
        };
        self.strength *= retention;
    }

    /// Whether this record is eligible for promotion.
    ///
    /// Requires: activation_count >= 5, strength >= 0.7, level < IDENTITY.
    pub fn can_promote(&self) -> bool {
        self.activation_count >= 5 && self.strength >= 0.7 && self.level < Level::Identity
    }

    /// Assess whether this record may be promoted automatically.
    ///
    /// Working memory may still graduate to Decisions while evidence is being
    /// reconciled. Promotion into the durable Domain/Identity tiers is blocked
    /// by explicit contradiction, conflict mass, or high volatility. Identity
    /// additionally requires the stricter tenure threshold previously enforced
    /// only by the background maintenance path.
    pub fn auto_promotion_block_reason(&self) -> Option<PromotionBlockReason> {
        if self.level >= Level::Identity {
            return Some(PromotionBlockReason::AlreadyIdentity);
        }
        if self.activation_count < 5 {
            return Some(PromotionBlockReason::InsufficientActivation);
        }
        if self.strength < 0.7 {
            return Some(PromotionBlockReason::InsufficientStrength);
        }

        self.epistemic_promotion_block_reason()
    }

    /// Assess only the epistemic/durability gates for the next level.
    ///
    /// This is also used by operator-facing candidate queries that support
    /// custom frequency thresholds without bypassing contradiction safety.
    pub fn epistemic_promotion_block_reason(&self) -> Option<PromotionBlockReason> {
        if self.level >= Level::Identity {
            return Some(PromotionBlockReason::AlreadyIdentity);
        }

        let target = self.level.promote()?;
        if target >= Level::Domain {
            if self.semantic_type == "contradiction" {
                return Some(PromotionBlockReason::ContradictionRecord);
            }
            if self.conflict_mass > 0 {
                return Some(PromotionBlockReason::ConflictingEvidence);
            }
            if self.volatility >= AUTO_PROMOTION_VOLATILITY_LIMIT {
                return Some(PromotionBlockReason::HighVolatility);
            }
        }

        if target == Level::Identity && (self.activation_count < 20 || self.strength < 0.9) {
            return Some(PromotionBlockReason::IdentityEvidenceThreshold);
        }

        None
    }

    /// Whether the shared governed policy allows automatic promotion.
    pub fn can_auto_promote(&self) -> bool {
        self.auto_promotion_block_reason().is_none()
    }

    /// Promote to the next level, if eligible.
    pub fn promote(&mut self) -> bool {
        if let Some(next) = self.level.promote() {
            self.level = next;
            true
        } else {
            false
        }
    }

    /// Add a bidirectional connection to another record.
    pub fn add_connection(&mut self, other_id: &str, weight: f32) {
        let clamped = weight.clamp(0.0, 1.0);
        self.connections.insert(other_id.to_string(), clamped);
    }

    /// Add a typed bidirectional connection to another record.
    pub fn add_typed_connection(&mut self, other_id: &str, weight: f32, relationship: &str) {
        self.add_connection(other_id, weight);
        self.connection_types
            .insert(other_id.to_string(), relationship.to_string());
    }

    /// Get the relationship type for a connection (None if untyped).
    pub fn connection_type(&self, other_id: &str) -> Option<&str> {
        self.connection_types.get(other_id).map(|s| s.as_str())
    }

    /// Days since creation.
    pub fn age_days(&self) -> f64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        (now - self.created_at) / 86400.0
    }

    /// Validate a namespace string.
    ///
    /// Rules: non-empty, max 64 chars, ASCII alphanumeric + hyphens + underscores.
    pub fn validate_namespace(ns: &str) -> Result<(), String> {
        if ns.is_empty() {
            return Err("Namespace cannot be empty".into());
        }
        if ns.len() > 64 {
            return Err("Namespace cannot exceed 64 characters".into());
        }
        if !ns
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(
                "Namespace must contain only ASCII alphanumeric, hyphens, or underscores".into(),
            );
        }
        Ok(())
    }

    /// Validate a source_type string.
    ///
    /// Must be one of: "recorded", "retrieved", "inferred", "generated".
    pub fn validate_source_type(st: &str) -> Result<(), String> {
        if VALID_SOURCE_TYPES.contains(&st) {
            Ok(())
        } else {
            Err(format!(
                "Invalid source_type '{}'. Must be one of: {}",
                st,
                VALID_SOURCE_TYPES.join(", ")
            ))
        }
    }

    /// Validate a semantic_type string.
    ///
    /// Must be one of: "fact", "decision", "trend", "serendipity", "preference", "contradiction".
    pub fn validate_semantic_type(st: &str) -> Result<(), String> {
        if VALID_SEMANTIC_TYPES.contains(&st) {
            Ok(())
        } else {
            Err(format!(
                "Invalid semantic_type '{}'. Must be one of: {}",
                st,
                VALID_SEMANTIC_TYPES.join(", ")
            ))
        }
    }

    // ── Epistemic helpers ──

    /// Base confidence from source type.
    pub fn default_confidence_for_source(source_type: &str) -> f32 {
        match source_type {
            "recorded" => 0.90,
            "retrieved" => 0.75,
            "inferred" => 0.60,
            "generated" => 0.50,
            _ => 0.50,
        }
    }

    /// Update epistemic signals after a maintenance cycle.
    ///
    /// Call this during maintenance with pre-computed neighbor counts.
    /// - `confirming`: number of neighbors that support this record
    /// - `conflicting`: number of neighbors that contradict this record
    pub fn update_epistemic_signals(&mut self, confirming: u32, conflicting: u32) {
        let prev_confidence = self.confidence;
        let prev_support = self.support_mass;
        let prev_conflict = self.conflict_mass;

        self.support_mass = confirming;
        self.conflict_mass = conflicting;

        // Volatility tracks epistemic-state movement, not retention change.
        // We use normalized deltas so stable repeated states converge downward.
        const VOLATILITY_ALPHA: f32 = 0.3;
        let confidence_delta = (self.confidence - prev_confidence).abs();
        let support_den = prev_support.max(confirming).max(1) as f32;
        let conflict_den = prev_conflict.max(conflicting).max(1) as f32;
        let support_delta = (confirming.abs_diff(prev_support) as f32 / support_den) * 0.2;
        let conflict_delta = (conflicting.abs_diff(prev_conflict) as f32 / conflict_den) * 0.8;
        let instant_volatility = (confidence_delta + support_delta + conflict_delta).min(1.0);
        self.volatility =
            VOLATILITY_ALPHA * instant_volatility + (1.0 - VOLATILITY_ALPHA) * self.volatility;
    }

    /// Epistemic health score — combines confidence with support/conflict ratio.
    /// Higher = more epistemically solid.
    pub fn epistemic_health(&self) -> f32 {
        let support_ln = (1.0 + self.support_mass as f32).ln();
        let conflict_ln = (1.0 + self.conflict_mass as f32).ln();
        let ratio = if support_ln + conflict_ln > 0.0 {
            support_ln / (support_ln + conflict_ln)
        } else {
            0.5 // no evidence either way
        };
        self.confidence * ratio * (1.0 - self.volatility * 0.5)
    }

    /// Days since last activation.
    pub fn days_since_activation(&self) -> f64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        (now - self.last_activated) / 86400.0
    }
}

#[cfg(feature = "python")]
#[pymethods]
impl Record {
    #[getter]
    fn get_id(&self) -> &str {
        &self.id
    }
    #[getter]
    fn get_content(&self) -> &str {
        &self.content
    }
    #[getter]
    fn get_level(&self) -> Level {
        self.level
    }
    #[getter]
    fn get_strength(&self) -> f32 {
        self.strength
    }
    #[getter]
    fn get_activation_count(&self) -> u32 {
        self.activation_count
    }
    #[getter]
    fn get_created_at(&self) -> f64 {
        self.created_at
    }
    #[getter]
    fn get_last_activated(&self) -> f64 {
        self.last_activated
    }
    #[getter]
    fn get_valid_from(&self) -> Option<f64> {
        self.valid_from
    }
    #[getter]
    fn get_valid_until(&self) -> Option<f64> {
        self.valid_until
    }
    #[getter]
    fn get_superseded_at(&self) -> Option<f64> {
        self.superseded_at
    }
    #[getter]
    fn get_tags(&self) -> Vec<String> {
        self.tags.clone()
    }
    #[getter]
    fn get_connections(&self) -> HashMap<String, f32> {
        self.connections.clone()
    }
    #[getter]
    fn get_connection_types(&self) -> HashMap<String, String> {
        self.connection_types.clone()
    }
    #[getter]
    fn get_content_type(&self) -> &str {
        &self.content_type
    }
    #[getter]
    fn get_metadata(&self) -> HashMap<String, String> {
        self.metadata.clone()
    }
    #[getter]
    fn get_aura_id(&self) -> Option<String> {
        self.aura_id.clone()
    }
    #[getter]
    fn get_caused_by_id(&self) -> Option<String> {
        self.caused_by_id.clone()
    }
    #[getter]
    fn get_namespace(&self) -> &str {
        &self.namespace
    }
    #[getter]
    fn get_source_type(&self) -> &str {
        &self.source_type
    }
    #[getter]
    fn get_semantic_type(&self) -> &str {
        &self.semantic_type
    }
    #[getter]
    fn get_activation_velocity(&self) -> f32 {
        self.activation_velocity
    }
    #[getter]
    fn get_confidence(&self) -> f32 {
        self.confidence
    }
    #[getter]
    fn get_support_mass(&self) -> u32 {
        self.support_mass
    }
    #[getter]
    fn get_conflict_mass(&self) -> u32 {
        self.conflict_mass
    }
    #[getter]
    fn get_volatility(&self) -> f32 {
        self.volatility
    }
    #[getter]
    fn get_epistemic_health(&self) -> f32 {
        self.epistemic_health()
    }
    #[getter]
    fn get_importance(&self) -> f32 {
        self.importance()
    }

    fn __repr__(&self) -> String {
        let ns_suffix = if self.namespace == DEFAULT_NAMESPACE {
            String::new()
        } else {
            format!(", ns='{}'", self.namespace)
        };
        format!(
            "Record(id='{}', level={}, strength={:.2}{}, content='{}...')",
            self.id,
            self.level.name(),
            self.strength,
            ns_suffix,
            &self.content.chars().take(40).collect::<String>()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consequence::{
        CONSEQUENCE_INCONCLUSIVE_TAG, CONSEQUENCE_REFUTE_TAG, CONSEQUENCE_SUPPORT_TAG,
    };

    fn tagged(level: Level, tag: &str) -> Record {
        let mut r = Record::new("x".into(), level);
        r.tags.push(tag.to_string());
        r
    }

    #[test]
    fn route_state_class_reads_consequence_tags() {
        assert_eq!(
            tagged(Level::Working, CONSEQUENCE_REFUTE_TAG).route_state_class(),
            RouteStateClass::Refuted
        );
        assert_eq!(
            tagged(Level::Working, CONSEQUENCE_SUPPORT_TAG).route_state_class(),
            RouteStateClass::Confirmed
        );
        assert_eq!(
            tagged(Level::Working, CONSEQUENCE_INCONCLUSIVE_TAG).route_state_class(),
            RouteStateClass::EvidenceDebt
        );
        // No consequence tag → plain candidate.
        assert_eq!(
            Record::new("x".into(), Level::Working).route_state_class(),
            RouteStateClass::Candidate
        );
    }

    #[test]
    fn refute_tag_wins_over_support_tag() {
        let mut r = Record::new("x".into(), Level::Working);
        r.tags.push(CONSEQUENCE_SUPPORT_TAG.to_string());
        r.tags.push(CONSEQUENCE_REFUTE_TAG.to_string());
        assert_eq!(r.route_state_class(), RouteStateClass::Refuted);
    }

    #[test]
    fn route_state_decay_never_touches_a_scar() {
        let mut scar = tagged(Level::Working, CONSEQUENCE_REFUTE_TAG);
        for _ in 0..100 {
            scar.apply_route_state_decay();
        }
        assert_eq!(scar.strength, 1.0, "a refuted scar must never field-decay");
        assert!(scar.is_alive());
    }

    #[test]
    fn route_state_decay_ignores_frequency_ordering() {
        // The proven contract: confirmed decays slower than a candidate
        // REGARDLESS of access frequency. Give the candidate a huge access
        // count — it must STILL decay faster than the rarely-accessed confirmed.
        let mut confirmed = tagged(Level::Working, CONSEQUENCE_SUPPORT_TAG);
        confirmed.activation_count = 1;
        let mut junk = Record::new("x".into(), Level::Working); // candidate
        junk.activation_count = 1000;

        for _ in 0..20 {
            confirmed.apply_route_state_decay();
            junk.apply_route_state_decay();
        }
        assert!(
            confirmed.strength > junk.strength,
            "confirmed {} must outlast frequent junk {}",
            confirmed.strength,
            junk.strength
        );
    }

    #[test]
    fn route_state_decay_respects_class_ordering() {
        let mut confirmed = tagged(Level::Working, CONSEQUENCE_SUPPORT_TAG);
        let mut debt = tagged(Level::Working, CONSEQUENCE_INCONCLUSIVE_TAG);
        let mut candidate = Record::new("x".into(), Level::Working);
        for _ in 0..10 {
            confirmed.apply_route_state_decay();
            debt.apply_route_state_decay();
            candidate.apply_route_state_decay();
        }
        // confirmed >= debt >= candidate (slower decay = more strength retained)
        assert!(confirmed.strength >= debt.strength);
        assert!(debt.strength >= candidate.strength);
    }

    #[test]
    fn test_new_record() {
        let rec = Record::new("Hello world".into(), Level::Working);
        assert_eq!(rec.content, "Hello world");
        assert_eq!(rec.level, Level::Working);
        assert_eq!(rec.strength, 1.0);
        assert_eq!(rec.activation_count, 0);
        assert!((rec.salience).abs() < 0.001);
        assert!(rec.is_alive());
        assert!(!rec.can_promote());
    }

    #[test]
    fn test_activate() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.strength = 0.5;
        rec.activate();
        assert_eq!(rec.strength, 0.7);
        assert_eq!(rec.activation_count, 1);
    }

    #[test]
    fn test_decay() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.apply_decay();
        // With 0 activations, rate = 0.80
        assert!((rec.strength - 0.80).abs() < 0.01);
    }

    #[test]
    fn test_adaptive_decay() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.activation_count = 10;
        rec.apply_decay();
        // With 10 activations, rate → 0.999
        assert!((rec.strength - 0.999).abs() < 0.01);
    }

    #[test]
    fn test_salience_reduces_decay_pressure() {
        let mut baseline = Record::new("baseline".into(), Level::Working);
        baseline.strength = 1.0;
        baseline.apply_decay();

        let mut salient = Record::new("salient".into(), Level::Working);
        salient.strength = 1.0;
        salient.salience = 1.0;
        salient.apply_decay();

        assert!(salient.strength > baseline.strength);
    }

    #[test]
    fn test_promotion() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.activation_count = 5;
        rec.strength = 0.8;
        assert!(rec.can_promote());
        assert!(rec.can_auto_promote());
        assert!(rec.promote());
        assert_eq!(rec.level, Level::Decisions);
    }

    #[test]
    fn durable_auto_promotion_pauses_on_conflict_and_volatility() {
        let mut conflicted = Record::new("new deployment rule".into(), Level::Decisions);
        conflicted.activation_count = 10;
        conflicted.strength = 0.9;
        conflicted.conflict_mass = 1;
        assert_eq!(
            conflicted.auto_promotion_block_reason(),
            Some(PromotionBlockReason::ConflictingEvidence)
        );

        let mut volatile = Record::new("unstable deployment rule".into(), Level::Decisions);
        volatile.activation_count = 10;
        volatile.strength = 0.9;
        volatile.volatility = AUTO_PROMOTION_VOLATILITY_LIMIT;
        assert_eq!(
            volatile.auto_promotion_block_reason(),
            Some(PromotionBlockReason::HighVolatility)
        );
    }

    #[test]
    fn identity_auto_promotion_requires_stricter_evidence_tenure() {
        let mut rec = Record::new("durable profile rule".into(), Level::Domain);
        rec.activation_count = 10;
        rec.strength = 0.95;
        assert_eq!(
            rec.auto_promotion_block_reason(),
            Some(PromotionBlockReason::IdentityEvidenceThreshold)
        );

        rec.activation_count = 20;
        assert!(rec.can_auto_promote());
    }

    #[test]
    fn test_importance() {
        let rec = Record::new("test".into(), Level::Identity);
        // strength=1.0 (0.4) + level=4/4 (0.25) + conn=0 (0) + act=0 (0) + salience=0 = 0.65
        assert!((rec.importance() - 0.65).abs() < 0.01);
    }

    #[test]
    fn test_salience_increases_importance() {
        let mut rec = Record::new("test".into(), Level::Identity);
        let baseline = rec.importance();
        rec.salience = 0.8;
        assert!(rec.importance() > baseline);
    }

    #[test]
    fn test_is_alive() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.strength = 0.05;
        assert!(rec.is_alive());
        rec.strength = 0.04;
        assert!(!rec.is_alive());
    }

    #[test]
    fn test_typed_connection() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.add_typed_connection("other-1", 0.8, "causal");
        rec.add_typed_connection("other-2", 0.5, "reflective");
        rec.add_connection("other-3", 0.3); // untyped

        assert_eq!(rec.connections.len(), 3);
        assert_eq!(rec.connection_types.len(), 2);
        assert_eq!(rec.connection_type("other-1"), Some("causal"));
        assert_eq!(rec.connection_type("other-2"), Some("reflective"));
        assert_eq!(rec.connection_type("other-3"), None);
    }

    #[test]
    fn test_typed_connection_serde() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.add_typed_connection("x", 0.7, "associative");

        let json = serde_json::to_string(&rec).unwrap();
        let restored: Record = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.connection_type("x"), Some("associative"));
        assert_eq!(restored.connections.get("x").copied(), Some(0.7));
    }

    // ── Epistemic field tests ──────────────────────────────────

    #[test]
    fn test_default_confidence_by_source() {
        assert!((Record::default_confidence_for_source("recorded") - 0.90).abs() < 0.001);
        assert!((Record::default_confidence_for_source("retrieved") - 0.75).abs() < 0.001);
        assert!((Record::default_confidence_for_source("inferred") - 0.60).abs() < 0.001);
        assert!((Record::default_confidence_for_source("generated") - 0.50).abs() < 0.001);
        assert!((Record::default_confidence_for_source("unknown") - 0.50).abs() < 0.001);
    }

    #[test]
    fn test_new_record_has_epistemic_defaults() {
        let rec = Record::new("test".into(), Level::Working);
        assert!((rec.confidence - 0.90).abs() < 0.001); // default source = "recorded"
        assert_eq!(rec.support_mass, 0);
        assert_eq!(rec.conflict_mass, 0);
        assert!((rec.volatility).abs() < 0.001);
    }

    #[test]
    fn test_update_epistemic_signals() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.update_epistemic_signals(5, 1);
        assert_eq!(rec.support_mass, 5);
        assert_eq!(rec.conflict_mass, 1);
        // volatility should be > 0 due to conflict_signal
        assert!(rec.volatility > 0.0);
    }

    #[test]
    fn test_epistemic_health_no_evidence() {
        let rec = Record::new("test".into(), Level::Working);
        let health = rec.epistemic_health();
        // confidence=0.9, no support/conflict -> ratio=0.5, volatility=0
        assert!((health - 0.9 * 0.5).abs() < 0.01);
    }

    #[test]
    fn test_epistemic_health_with_support() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.support_mass = 10;
        rec.conflict_mass = 0;
        let health = rec.epistemic_health();
        // ratio = ln(11)/(ln(11)+ln(1)) = 1.0 (ln(1)=0)
        assert!((health - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_backward_compat_no_epistemic_fields() {
        let rec = Record::new("old record".into(), Level::Working);
        let mut json_val: serde_json::Value = serde_json::to_value(&rec).unwrap();
        json_val.as_object_mut().unwrap().remove("confidence");
        json_val.as_object_mut().unwrap().remove("support_mass");
        json_val.as_object_mut().unwrap().remove("conflict_mass");
        json_val.as_object_mut().unwrap().remove("volatility");
        json_val.as_object_mut().unwrap().remove("salience");
        let restored: Record = serde_json::from_value(json_val).unwrap();
        assert!((restored.confidence - 0.90).abs() < 0.001);
        assert_eq!(restored.support_mass, 0);
        assert_eq!(restored.conflict_mass, 0);
        assert!((restored.volatility).abs() < 0.001);
        assert!((restored.salience).abs() < 0.001);
    }

    #[test]
    fn temporal_validity_is_half_open() {
        let mut rec = Record::new("dated rule".into(), Level::Domain);
        rec.set_validity(Some(100.0), Some(200.0)).unwrap();
        assert!(!rec.is_valid_at(99.999));
        assert!(rec.is_valid_at(100.0));
        assert!(rec.is_valid_at(199.999));
        assert!(!rec.is_valid_at(200.0));
    }

    #[test]
    fn temporal_validity_rejects_invalid_intervals() {
        let mut rec = Record::new("dated rule".into(), Level::Domain);
        assert!(rec.set_validity(Some(200.0), Some(100.0)).is_err());
        assert!(rec.set_validity(Some(100.0), Some(100.0)).is_err());
        assert!(rec.set_validity(Some(f64::NAN), None).is_err());
        assert!(rec.set_validity(None, Some(f64::INFINITY)).is_err());
    }

    #[test]
    fn temporal_fields_are_backward_compatible() {
        let rec = Record::new("legacy record".into(), Level::Working);
        let mut json_val: serde_json::Value = serde_json::to_value(&rec).unwrap();
        let object = json_val.as_object_mut().unwrap();
        object.remove("valid_from");
        object.remove("valid_until");
        object.remove("superseded_at");
        let restored: Record = serde_json::from_value(json_val).unwrap();
        assert_eq!(restored.valid_from, None);
        assert_eq!(restored.valid_until, None);
        assert_eq!(restored.superseded_at, None);
        assert!(restored.is_valid_at(0.0));
    }

    #[test]
    fn test_backward_compat_no_types() {
        // Old records without connection_types should deserialize fine
        // Serialize a record, strip connection_types, and re-deserialize
        let mut rec = Record::new("old record".into(), Level::Working);
        rec.add_connection("other", 0.5);

        let mut json_val: serde_json::Value = serde_json::to_value(&rec).unwrap();
        // Remove connection_types to simulate old data format
        json_val.as_object_mut().unwrap().remove("connection_types");

        let restored: Record = serde_json::from_value(json_val).unwrap();
        assert_eq!(restored.connections.len(), 1);
        assert!(restored.connection_types.is_empty()); // #[serde(default)] ensures this
        assert_eq!(restored.connection_type("other"), None);
    }

    // ── Namespace tests ───────────────────────────────────────────

    #[test]
    fn test_default_namespace() {
        let rec = Record::new("test".into(), Level::Working);
        assert_eq!(rec.namespace, "default");
    }

    #[test]
    fn test_custom_namespace() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.namespace = "project-x".to_string();
        assert_eq!(rec.namespace, "project-x");
    }

    #[test]
    fn test_backward_compat_no_namespace() {
        // Old records without namespace field should deserialize with "default"
        let rec = Record::new("old record".into(), Level::Working);
        let mut json_val: serde_json::Value = serde_json::to_value(&rec).unwrap();
        json_val.as_object_mut().unwrap().remove("namespace");
        let restored: Record = serde_json::from_value(json_val).unwrap();
        assert_eq!(restored.namespace, "default");
    }

    #[test]
    fn test_namespace_serialization_roundtrip() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.namespace = "custom-ns".to_string();
        let json = serde_json::to_string(&rec).unwrap();
        let restored: Record = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.namespace, "custom-ns");
    }

    #[test]
    fn test_validate_namespace() {
        assert!(Record::validate_namespace("default").is_ok());
        assert!(Record::validate_namespace("project-x").is_ok());
        assert!(Record::validate_namespace("test_ns").is_ok());
        assert!(Record::validate_namespace("ns123").is_ok());
        assert!(Record::validate_namespace("").is_err());
        assert!(Record::validate_namespace("ab cd").is_err());
        assert!(Record::validate_namespace("ns/path").is_err());
        assert!(Record::validate_namespace(&"a".repeat(65)).is_err());
        assert!(Record::validate_namespace(&"a".repeat(64)).is_ok());
    }

    // ── Source type tests ─────────────────────────────────────────

    #[test]
    fn test_default_source_type() {
        let rec = Record::new("test".into(), Level::Working);
        assert_eq!(rec.source_type, "recorded");
    }

    #[test]
    fn test_custom_source_type() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.source_type = "retrieved".to_string();
        assert_eq!(rec.source_type, "retrieved");
    }

    #[test]
    fn test_backward_compat_no_source_type() {
        let rec = Record::new("old record".into(), Level::Working);
        let mut json_val: serde_json::Value = serde_json::to_value(&rec).unwrap();
        json_val.as_object_mut().unwrap().remove("source_type");
        let restored: Record = serde_json::from_value(json_val).unwrap();
        assert_eq!(restored.source_type, "recorded");
    }

    #[test]
    fn test_source_type_serialization_roundtrip() {
        let mut rec = Record::new("test".into(), Level::Working);
        rec.source_type = "inferred".to_string();
        let json = serde_json::to_string(&rec).unwrap();
        let restored: Record = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.source_type, "inferred");
    }

    #[test]
    fn test_validate_source_type() {
        assert!(Record::validate_source_type("recorded").is_ok());
        assert!(Record::validate_source_type("retrieved").is_ok());
        assert!(Record::validate_source_type("inferred").is_ok());
        assert!(Record::validate_source_type("generated").is_ok());
        assert!(Record::validate_source_type("unknown").is_err());
        assert!(Record::validate_source_type("").is_err());
        assert!(Record::validate_source_type("banana").is_err());
    }
}
