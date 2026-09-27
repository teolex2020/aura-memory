//! Write-authority rules for externally supplied memory fields.
//!
//! Generic writes (`store`, `update`, MCP/HTTP tools, context imports) carry
//! whatever tags and metadata the caller — possibly an injected model — chose.
//! Some of those fields confer authority when read back:
//!
//! * consequence tags and `cu_*` metadata turn a record into a *lived* outcome
//!   that drives `consequence_policy_hint` and slower decay;
//! * `source` / `verified` / `trust_score` feed recall trust weighting;
//! * `source_type` ranks epistemic reliability.
//!
//! Only dedicated APIs may set these: `capture_consequence` for outcomes and
//! the `channel` argument for provenance. Generic writes that try to set them
//! are rejected, and claimed provenance is kept only as `claimed_*` metadata.

use std::collections::HashMap;

use anyhow::Result;

use crate::consequence::{
    CONSEQUENCE_INCONCLUSIVE_TAG, CONSEQUENCE_REFUTE_TAG, CONSEQUENCE_SUPPORT_TAG,
    CONSEQUENCE_UNIT_TAG, META_KIND,
};

/// Who is performing a write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteAuthority {
    /// Caller-controlled tags and metadata (default for every public write API).
    External,
    /// Internal capture path that constructs consequence fields itself.
    TrustedCapture,
}

/// Metadata keys whose value is always computed by `stamp_provenance`.
pub const PROVENANCE_KEYS: [&str; 3] = ["source", "verified", "trust_score"];

/// Prefix under which caller-claimed provenance values are preserved.
pub const CLAIMED_PREFIX: &str = "claimed_";

/// Tags that mark a record as a captured consequence.
pub fn is_reserved_tag(tag: &str) -> bool {
    matches!(
        tag,
        CONSEQUENCE_UNIT_TAG
            | CONSEQUENCE_SUPPORT_TAG
            | CONSEQUENCE_REFUTE_TAG
            | CONSEQUENCE_INCONCLUSIVE_TAG
    )
}

/// Metadata entries that describe a captured consequence.
pub fn is_reserved_metadata(key: &str, value: &str) -> bool {
    key.starts_with("cu_") || (key == "kind" && value == META_KIND)
}

/// Reject consequence fields on an external write.
pub fn check_external_fields(
    tags: &[String],
    metadata: Option<&HashMap<String, String>>,
) -> Result<()> {
    if let Some(tag) = tags.iter().find(|tag| is_reserved_tag(tag)) {
        anyhow::bail!(
            "tag {tag:?} is reserved for captured consequences; use capture_consequence()"
        );
    }
    if let Some((key, _)) = metadata
        .into_iter()
        .flatten()
        .find(|(key, value)| is_reserved_metadata(key, value))
    {
        anyhow::bail!(
            "metadata key {key:?} is reserved for captured consequences; use capture_consequence()"
        );
    }
    Ok(())
}

/// Remove consequence fields from externally sourced data that is imported
/// best-effort (for example shared context fragments).
pub fn strip_reserved(tags: &mut Vec<String>, metadata: &mut HashMap<String, String>) -> usize {
    let before = tags.len() + metadata.len();
    tags.retain(|tag| !is_reserved_tag(tag));
    metadata.retain(|key, value| !is_reserved_metadata(key, value));
    before - tags.len() - metadata.len()
}

/// Epistemic rank of a `source_type`; higher is more trusted.
pub fn source_type_rank(source_type: &str) -> u8 {
    match source_type {
        "recorded" => 3,
        "retrieved" => 2,
        "inferred" => 1,
        "generated" => 0,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consequence_tags_and_metadata_are_rejected_on_external_writes() {
        assert!(check_external_fields(&["consequence-support".into()], None).is_err());
        let forged = HashMap::from([("cu_trust".to_string(), "1".to_string())]);
        assert!(check_external_fields(&[], Some(&forged)).is_err());
        let kind = HashMap::from([("kind".to_string(), META_KIND.to_string())]);
        assert!(check_external_fields(&[], Some(&kind)).is_err());

        let benign = HashMap::from([("kind".to_string(), "note".to_string())]);
        assert!(check_external_fields(&["workflow".into()], Some(&benign)).is_ok());
    }

    #[test]
    fn strip_reserved_keeps_ordinary_fields() {
        let mut tags = vec!["consequence-refute".to_string(), "ops".to_string()];
        let mut metadata = HashMap::from([
            ("cu_action".to_string(), "deploy".to_string()),
            ("team".to_string(), "infra".to_string()),
        ]);
        assert_eq!(strip_reserved(&mut tags, &mut metadata), 2);
        assert_eq!(tags, vec!["ops".to_string()]);
        assert_eq!(metadata.len(), 1);
    }

    #[test]
    fn source_type_rank_orders_reliability() {
        assert!(source_type_rank("recorded") > source_type_rank("retrieved"));
        assert!(source_type_rank("retrieved") > source_type_rank("inferred"));
        assert!(source_type_rank("inferred") > source_type_rank("generated"));
    }
}
