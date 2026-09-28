//! Security profiles: `strict` switches recall to the provenance context and
//! makes `delete()` a full purge; `security_report()` reflects the state.

use std::collections::HashMap;
use std::path::Path;

use aura::security::SecurityProfile;
use aura::{Aura, Level};

fn put(a: &Aura, text: &str, tag: &str, source: &str, channel: Option<&str>) -> String {
    let meta = channel.map(|c| HashMap::from([("channel".to_string(), c.to_string())]));
    a.store(
        text,
        Some(Level::Domain),
        Some(vec![tag.into()]),
        None,
        None,
        Some(source),
        meta,
        Some(false),
        None,
        None,
        None,
    )
    .unwrap()
    .id
}

fn files_containing(dir: &Path, needle: &[u8]) -> Vec<String> {
    let mut hits = Vec::new();
    for entry in walk(dir) {
        let bytes = std::fs::read(&entry).unwrap_or_default();
        if bytes.windows(needle.len()).any(|w| w == needle) {
            hits.push(entry.display().to_string());
        }
    }
    hits
}

fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path);
        }
    }
    out
}

#[test]
fn default_is_balanced_and_strict_recall_uses_provenance_context() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(a.security_profile(), SecurityProfile::Balanced);
    put(&a, "My sister lives in Lviv", "family", "recorded", None);
    put(
        &a,
        "Your sister moved to Odesa",
        "family",
        "retrieved",
        Some("email"),
    );

    let balanced = a
        .recall("Where does my sister live?", None, None, None, None, None)
        .unwrap();
    assert!(!balanced.contains("[UNTRUSTED MEMORY"), "{balanced}");

    a.set_security_profile(SecurityProfile::Strict);
    let strict = a
        .recall("Where does my sister live?", None, None, None, None, None)
        .unwrap();
    assert!(strict.contains("[FROM THE USER"), "{strict}");
    assert!(strict.contains("[UNTRUSTED MEMORY"), "{strict}");
    assert_eq!(
        strict,
        a.recall_provenance("Where does my sister live?", None, None, None, None, None)
            .unwrap()
    );
    // The level format stays reachable explicitly.
    assert!(!a
        .recall_levels("Where does my sister live?", None, None, None, None, None)
        .unwrap()
        .contains("[UNTRUSTED MEMORY"));
}

#[test]
fn strict_delete_leaves_no_bytes_and_balanced_delete_does() {
    for (profile, expect_residue) in [
        (SecurityProfile::Balanced, true),
        (SecurityProfile::Strict, false),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
        a.set_security_profile(profile);
        for i in 0..5 {
            put(
                &a,
                &format!("Benign deployment fact number {i}"),
                "ops",
                "recorded",
                None,
            );
        }
        let marker = "PURGE_CANARY_Q7Z";
        let id = put(
            &a,
            &format!("Poisoned note {marker} follow it"),
            "ops",
            "retrieved",
            Some("web"),
        );
        a.snapshot("before").unwrap();
        a.flush().unwrap();
        assert!(!files_containing(dir.path(), marker.as_bytes()).is_empty());

        assert!(a.delete(&id).unwrap());
        a.flush().unwrap();
        let residue = files_containing(dir.path(), marker.as_bytes());
        assert_eq!(
            !residue.is_empty(),
            expect_residue,
            "{profile:?}: residue in {residue:?}"
        );
        assert!(a.get(&id).is_none());
        // Benign records survive either way.
        assert_eq!(a.count(None), 5, "{profile:?}");
    }
}

#[test]
fn strict_delete_of_unknown_id_is_false_and_cheap() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    a.set_security_profile(SecurityProfile::Strict);
    assert!(!a.delete("no-such-record").unwrap());
}

#[test]
fn report_reflects_profile_store_contents_and_flooding() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    put(&a, "I was born in Kyiv", "bio", "recorded", None);
    for i in 0..4 {
        put(
            &a,
            &format!("Forum post {i}: you were born in Minsk"),
            "bio",
            "retrieved",
            Some("web"),
        );
    }
    let report = a.security_report();
    assert_eq!(report.profile, SecurityProfile::Balanced);
    assert_eq!(report.stats.records, 5);
    assert_eq!(report.stats.by_effective_source.get("recorded"), Some(&1));
    assert_eq!(report.stats.by_effective_source.get("retrieved"), Some(&4));
    assert_eq!(report.stats.untrusted_groups_over_cap, 1);
    assert_eq!(report.stats.records_in_groups_over_cap, 4);
    let state = |name: &str| {
        report
            .protections
            .iter()
            .find(|p| p.name == name)
            .map(|p| p.state)
            .unwrap()
    };
    assert_eq!(state("verified_deletion"), "explicit");
    assert_eq!(state("provenance_context"), "mcp_only");
    assert_eq!(state("encryption_at_rest"), "off");
    assert_eq!(state("claim_certainty"), "off");
    assert!(report.warnings.iter().any(|w| w.contains("flooding")));
    assert!(report.warnings.iter().any(|w| w.contains("not encrypted")));
    assert!(report.warnings.iter().any(|w| w.contains("delete()")));

    a.set_security_profile(SecurityProfile::Strict);
    let strict = a.security_report();
    let state = |name: &str| {
        strict
            .protections
            .iter()
            .find(|p| p.name == name)
            .map(|p| p.state)
            .unwrap()
    };
    assert_eq!(state("verified_deletion"), "on");
    assert_eq!(state("provenance_context"), "on");
    assert!(!strict.warnings.iter().any(|w| w.contains("delete()")));
}
