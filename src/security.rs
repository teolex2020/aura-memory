//! Security profiles and the security report.
//!
//! Most protections are always on (authority checks on writes, provenance
//! stamping, the evidence floor for advice, repetition resistance). A profile
//! only switches the ones that change behaviour a host may rely on:
//!
//! * `balanced` (default) — `delete()` is a logical delete (bytes can remain
//!   in storage history until `purge_record` is called).
//! * `strict` — `delete()` purges the record from storage, snapshots and
//!   audit history (experiment E1).
//!
//! In every profile `recall()` returns the provenance context: first-hand
//! memory with its reasons, separated from quoted, fenced untrusted memory
//! (experiments E10, E13, E14b, E15). `format="levels"` / `recall_levels`
//! keeps the older level-grouped context.
//!
//! `security_report()` lists every protection with its state and the
//! experiment behind it, counts what the store holds by effective source, and
//! warns about protections that are off.

use std::collections::BTreeMap;

use crate::record::Record;

/// Behaviour profile for protections that change host-visible behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SecurityProfile {
    #[default]
    Balanced,
    Strict,
}

impl SecurityProfile {
    pub const ALL: &'static [&'static str] = &["balanced", "strict"];

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            "balanced" => Ok(Self::Balanced),
            "strict" => Ok(Self::Strict),
            other => anyhow::bail!(
                "unknown security profile {other:?}; expected one of {:?}",
                Self::ALL
            ),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Balanced => "balanced",
            Self::Strict => "strict",
        }
    }

    pub(crate) fn to_u8(self) -> u8 {
        match self {
            Self::Balanced => 0,
            Self::Strict => 1,
        }
    }

    pub(crate) fn from_u8(value: u8) -> Self {
        if value == 1 {
            Self::Strict
        } else {
            Self::Balanced
        }
    }
}

/// One protection and its current state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Protection {
    pub name: &'static str,
    /// `on`, `off`, `partial`, `mcp_only`, `explicit` or `not_in_core`.
    pub state: &'static str,
    /// Experiment or test that measured it.
    pub evidence: &'static str,
    pub detail: String,
}

/// What the store currently holds, from a security point of view.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SecurityStats {
    pub records: usize,
    /// Record counts by effective source (`certainty::effective_source_type`).
    pub by_effective_source: BTreeMap<String, usize>,
    /// Claimed `recorded` but written by a model (MCP tools).
    pub relayed_by_model: usize,
    /// Classified as hearsay or speculative.
    pub hearsay_or_speculative: usize,
    /// Records with restricted ACL visibility.
    pub restricted: usize,
    /// Untrusted source groups holding more records than recall lets through.
    pub untrusted_groups_over_cap: usize,
    /// Records in those groups.
    pub records_in_groups_over_cap: usize,
    /// First-hand records whose write channel names an outside source.
    pub outside_channel_first_hand: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityReport {
    pub profile: SecurityProfile,
    pub protections: Vec<Protection>,
    pub stats: SecurityStats,
    pub warnings: Vec<String>,
}

/// Inputs the report needs from the Aura instance.
pub(crate) struct ReportInputs {
    pub profile: SecurityProfile,
    pub encrypted: bool,
    pub audit_log: bool,
    pub claim_classifier: bool,
    pub claim_rules: bool,
}

pub(crate) fn stats<'a>(records: impl Iterator<Item = &'a Record>) -> SecurityStats {
    let mut stats = SecurityStats::default();
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    for record in records {
        stats.records += 1;
        *stats
            .by_effective_source
            .entry(crate::certainty::effective_source_type(record).to_string())
            .or_insert(0) += 1;
        let meta = |key: &str| record.metadata.get(key).map(String::as_str);
        if meta(crate::certainty::META_RELAYED_BY_MODEL) == Some("true") {
            stats.relayed_by_model += 1;
        }
        if matches!(
            meta(crate::certainty::META_CLAIM_CERTAINTY),
            Some("hearsay") | Some("speculative")
        ) {
            stats.hearsay_or_speculative += 1;
        }
        if meta(crate::acl::ACL_VISIBILITY_KEY) == Some("restricted") {
            stats.restricted += 1;
        }
        if let Some(group) = crate::recall::untrusted_group(record) {
            *groups.entry(group).or_insert(0) += 1;
        }
        if let Some(channel) = meta("channel") {
            if crate::trust::source_type_for_channel(channel) != "recorded"
                && crate::certainty::effective_source_type(record) == "recorded"
            {
                stats.outside_channel_first_hand += 1;
            }
        }
    }
    for count in groups.values() {
        if *count > crate::recall::UNTRUSTED_GROUP_CAP {
            stats.untrusted_groups_over_cap += 1;
            stats.records_in_groups_over_cap += count;
        }
    }
    stats
}

pub(crate) fn report(inputs: ReportInputs, stats: SecurityStats) -> SecurityReport {
    let strict = inputs.profile == SecurityProfile::Strict;
    let on = |flag: bool| if flag { "on" } else { "off" };
    let certainty_state = if inputs.claim_classifier {
        "on"
    } else if inputs.claim_rules {
        "partial"
    } else {
        "off"
    };
    let protections = vec![
        Protection {
            name: "authority_forgery_blocked",
            state: "on",
            evidence: "tests/ingress_authority.rs",
            detail: "external writes cannot set reserved consequence tags or outcome metadata".into(),
        },
        Protection {
            name: "provenance_stamped",
            state: "on",
            evidence: "E2",
            detail: "source, verification and trust fields are set by Aura; caller values are kept as claimed_*".into(),
        },
        Protection {
            name: "untrusted_advice_capped",
            state: "on",
            evidence: "E2",
            detail: "policy hints backed only by untrusted evidence are capped at verify-first".into(),
        },
        Protection {
            name: "model_writes_downgraded",
            state: "on",
            evidence: "E3",
            detail: "MCP model writes default to inferred; a claimed recorded source is marked relayed_by_model".into(),
        },
        Protection {
            name: "repetition_flood_resistance",
            state: "partial",
            evidence: "E11",
            detail: "one untrusted source group keeps at most 2 recall slots; 2 of 4 attack kinds fully resisted".into(),
        },
        Protection {
            name: "provenance_context",
            state: "on",
            evidence: "E10/E13/E14b/E15",
            detail: "recall() separates first-hand memory from fenced untrusted memory; format=\"levels\" opts out".into(),
        },
        Protection {
            name: "verified_deletion",
            state: if strict { "on" } else { "explicit" },
            evidence: "E1",
            detail: if strict {
                "delete() purges storage, snapshots and audit history".into()
            } else {
                "delete() is logical; bytes can remain until purge_record(id, \"history\")".into()
            },
        },
        Protection {
            name: "encryption_at_rest",
            state: on(inputs.encrypted),
            evidence: "open with a password",
            detail: "records, logs and snapshots encrypted with the store key".into(),
        },
        Protection {
            name: "audit_log",
            state: on(inputs.audit_log),
            evidence: "audit.rs",
            detail: "store, delete, purge and correction events are logged".into(),
        },
        Protection {
            name: "claim_certainty",
            state: certainty_state,
            evidence: "E3/E4",
            detail: "hearsay and speculation from the user lower trust; reliable only with a claim classifier hook".into(),
        },
        Protection {
            name: "action_gate",
            state: "not_in_core",
            evidence: "E12/E12b",
            detail: "tool-call argument provenance is an experiment, not part of the library".into(),
        },
    ];

    let mut warnings = Vec::new();
    if !strict {
        warnings.push(
            "delete() leaves recoverable bytes; use the strict profile or purge_record for removal requests".into(),
        );
    }
    if !inputs.encrypted {
        warnings.push("memory is not encrypted at rest".into());
    }
    if !inputs.claim_classifier {
        warnings.push(
            "no claim classifier: hearsay the user relays is trusted like first-hand statements"
                .into(),
        );
    }
    if stats.outside_channel_first_hand > 0 {
        warnings.push(format!(
            "{} record(s) came through an outside channel but are marked first-hand: \
             they appear as the user's own words; pass source_type or leave it to the channel",
            stats.outside_channel_first_hand
        ));
    }
    if stats.untrusted_groups_over_cap > 0 {
        warnings.push(format!(
            "{} untrusted source group(s) repeat beyond the recall cap ({} records): possible flooding",
            stats.untrusted_groups_over_cap, stats.records_in_groups_over_cap
        ));
    }
    SecurityReport {
        profile: inputs.profile,
        protections,
        stats,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_round_trips_and_rejects_unknown() {
        for name in SecurityProfile::ALL {
            let profile = SecurityProfile::parse(name).unwrap();
            assert_eq!(profile.as_str(), *name);
            assert_eq!(SecurityProfile::from_u8(profile.to_u8()), profile);
        }
        assert!(SecurityProfile::parse("paranoid").is_err());
    }
}
