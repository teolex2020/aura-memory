//! Record-level permission-aware retrieval.
//!
//! Namespace isolation remains the tenant boundary. ACL metadata adds
//! role/group/principal restrictions within that boundary.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::record::Record;

pub const ACL_VISIBILITY_KEY: &str = "acl_visibility";
pub const ACL_READ_ROLES_KEY: &str = "acl_read_roles";
pub const ACL_READ_GROUPS_KEY: &str = "acl_read_groups";
pub const ACL_READ_PRINCIPALS_KEY: &str = "acl_read_principals";
pub const ACL_POLICY_VERSION_KEY: &str = "acl_policy_version";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AclVisibility {
    Public,
    Restricted,
}

impl AclVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Restricted => "restricted",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AclEnforcementMode {
    Audit,
    Enforce,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AclContext {
    pub subject_id: Option<String>,
    pub roles: HashSet<String>,
    pub groups: HashSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclDecision {
    pub allowed: bool,
    pub reason: String,
    pub policy_version: Option<String>,
}

pub fn apply_acl_metadata(
    metadata: &mut HashMap<String, String>,
    visibility: AclVisibility,
    read_roles: &[String],
    read_groups: &[String],
    read_principals: &[String],
    policy_version: Option<&str>,
) {
    metadata.insert(ACL_VISIBILITY_KEY.into(), visibility.as_str().into());
    set_list(metadata, ACL_READ_ROLES_KEY, read_roles);
    set_list(metadata, ACL_READ_GROUPS_KEY, read_groups);
    set_list(metadata, ACL_READ_PRINCIPALS_KEY, read_principals);
    match policy_version {
        Some(version) => {
            metadata.insert(ACL_POLICY_VERSION_KEY.into(), version.to_string());
        }
        None => {
            metadata.remove(ACL_POLICY_VERSION_KEY);
        }
    }
}

pub fn evaluate(record: &Record, context: &AclContext) -> AclDecision {
    let policy_version = record.metadata.get(ACL_POLICY_VERSION_KEY).cloned();
    match record.metadata.get(ACL_VISIBILITY_KEY).map(String::as_str) {
        None | Some("public") => AclDecision {
            allowed: true,
            reason: "public_or_legacy".into(),
            policy_version,
        },
        Some("restricted") => {
            let roles = parse_list(record.metadata.get(ACL_READ_ROLES_KEY));
            let groups = parse_list(record.metadata.get(ACL_READ_GROUPS_KEY));
            let principals = parse_list(record.metadata.get(ACL_READ_PRINCIPALS_KEY));
            let principal_match = context
                .subject_id
                .as_ref()
                .is_some_and(|subject| principals.contains(&subject.to_lowercase()));
            let role_match = context
                .roles
                .iter()
                .any(|role| roles.contains(&role.to_lowercase()));
            let group_match = context
                .groups
                .iter()
                .any(|group| groups.contains(&group.to_lowercase()));
            let allowed = principal_match || role_match || group_match;
            AclDecision {
                allowed,
                reason: if allowed {
                    "allow_list_match".into()
                } else {
                    "restricted_no_match".into()
                },
                policy_version,
            }
        }
        Some(_) => AclDecision {
            allowed: false,
            reason: "invalid_visibility_deny".into(),
            policy_version,
        },
    }
}

fn set_list(metadata: &mut HashMap<String, String>, key: &str, values: &[String]) {
    if values.is_empty() {
        metadata.remove(key);
    } else {
        let mut normalized: Vec<String> = values
            .iter()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect();
        normalized.sort();
        normalized.dedup();
        metadata.insert(key.into(), normalized.join(","));
    }
}

fn parse_list(value: Option<&String>) -> HashSet<String> {
    value
        .into_iter()
        .flat_map(|raw| raw.split(','))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    #[test]
    fn restricted_is_deny_by_default_and_allows_any_matching_axis() {
        let mut record = Record::new("finance plan".into(), Level::Domain);
        apply_acl_metadata(
            &mut record.metadata,
            AclVisibility::Restricted,
            &["finance".into()],
            &[],
            &["alice".into()],
            Some("v1"),
        );

        assert!(!evaluate(&record, &AclContext::default()).allowed);
        let mut role_context = AclContext::default();
        role_context.roles.insert("finance".into());
        assert!(evaluate(&record, &role_context).allowed);
        let principal_context = AclContext {
            subject_id: Some("alice".into()),
            ..AclContext::default()
        };
        assert!(evaluate(&record, &principal_context).allowed);
    }

    #[test]
    fn invalid_visibility_denies() {
        let mut record = Record::new("bad policy".into(), Level::Domain);
        record
            .metadata
            .insert(ACL_VISIBILITY_KEY.into(), "unknown".into());
        assert!(!evaluate(&record, &AclContext::default()).allowed);
    }
}
