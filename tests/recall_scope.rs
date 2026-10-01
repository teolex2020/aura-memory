//! Desktop app permissions: what one app may receive from recall.

use std::collections::HashMap;

use aura::recall::{RecallScope, META_PRIVATE};
use aura::{Aura, Level};

fn open() -> (tempfile::TempDir, Aura) {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    (dir, a)
}

fn put(
    a: &Aura,
    text: &str,
    level: Level,
    source: &str,
    meta: &[(&str, &str)],
    parent: Option<&str>,
) -> String {
    let metadata: HashMap<String, String> = meta
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    a.store(
        text,
        Some(level),
        None,
        None,
        None,
        Some(source),
        Some(metadata),
        Some(false),
        parent,
        None,
        None,
    )
    .unwrap()
    .id
}

fn cloud() -> RecallScope {
    RecallScope::default()
}

#[test]
fn private_records_reach_only_local_models() {
    let (_d, a) = open();
    put(
        &a,
        "My HIV treatment is at the city clinic on Fridays",
        Level::Domain,
        "recorded",
        &[(META_PRIVATE, "true")],
        None,
    );
    put(
        &a,
        "The city clinic parking is free on Fridays",
        Level::Domain,
        "recorded",
        &[],
        None,
    );
    let q = "What happens at the city clinic on Fridays?";
    let to_cloud = a.recall_provenance_scoped(q, None, &cloud()).unwrap();
    assert!(!to_cloud.contains("HIV"), "{to_cloud}");
    assert!(to_cloud.contains("parking"), "{to_cloud}");
    let local = RecallScope {
        include_private: true,
        ..cloud()
    };
    let to_local = a.recall_provenance_scoped(q, None, &local).unwrap();
    assert!(to_local.contains("HIV"), "{to_local}");
    // The cache never hands one scope's context to another.
    let again = a.recall_provenance_scoped(q, None, &cloud()).unwrap();
    assert!(!again.contains("HIV"), "{again}");
}

#[test]
fn a_private_parent_never_leaks_as_a_reason() {
    let (_d, a) = open();
    let parent = put(
        &a,
        "Diagnosed with epilepsy in 2024",
        Level::Domain,
        "recorded",
        &[(META_PRIVATE, "true")],
        None,
    );
    put(
        &a,
        "Decided never to drive at night",
        Level::Decisions,
        "recorded",
        &[],
        Some(&parent),
    );
    let context = a
        .recall_provenance_scoped("Why don't I drive at night?", None, &cloud())
        .unwrap();
    assert!(context.contains("never to drive at night"), "{context}");
    assert!(!context.contains("epilepsy"), "{context}");
}

#[test]
fn identity_facts_can_be_withheld() {
    let (_d, a) = open();
    put(
        &a,
        "I am allergic to penicillin",
        Level::Identity,
        "recorded",
        &[],
        None,
    );
    for i in 0..30 {
        put(
            &a,
            &format!("Build note {i}: the release job runs on tags"),
            Level::Working,
            "recorded",
            &[],
            None,
        );
    }
    let q = "How do releases run?";
    let with = a.recall_provenance_scoped(q, None, &cloud()).unwrap();
    assert!(with.contains("penicillin"), "{with}");
    let without = RecallScope {
        include_identity: false,
        ..cloud()
    };
    let ctx = a.recall_provenance_scoped(q, None, &without).unwrap();
    assert!(!ctx.contains("penicillin"), "{ctx}");
    assert!(ctx.contains("release job"), "{ctx}");
}

#[test]
fn other_apps_imports_and_outside_content_can_be_withheld() {
    let (_d, a) = open();
    put(
        &a,
        "Deploy target for the shop is Hetzner",
        Level::Domain,
        "inferred",
        &[("client", "cursor")],
        None,
    );
    put(
        &a,
        "Deploy target for the blog is Netlify",
        Level::Domain,
        "inferred",
        &[("client", "claude-code")],
        None,
    );
    put(
        &a,
        "I deploy only on weekdays",
        Level::Domain,
        "recorded",
        &[],
        None,
    );
    put(
        &a,
        "Deploy checklist from the vendor wiki",
        Level::Domain,
        "retrieved",
        &[],
        None,
    );
    put(
        &a,
        "Deploy notes imported from my old notebook",
        Level::Domain,
        "retrieved",
        &[("imported", "true")],
        None,
    );
    let q = "Where and when do I deploy?";

    let own = RecallScope {
        only_client: Some("claude-code".into()),
        ..cloud()
    };
    let ctx = a.recall_provenance_scoped(q, None, &own).unwrap();
    assert!(ctx.contains("Netlify") && ctx.contains("weekdays"), "{ctx}");
    assert!(!ctx.contains("Hetzner"), "{ctx}");

    let no_outside = RecallScope {
        include_outside: false,
        include_imported: false,
        ..cloud()
    };
    let ctx = a.recall_provenance_scoped(q, None, &no_outside).unwrap();
    assert!(
        !ctx.contains("vendor wiki") && !ctx.contains("old notebook"),
        "{ctx}"
    );
    assert!(ctx.contains("weekdays"), "{ctx}");
}

#[test]
fn plain_recall_is_unchanged() {
    let (_d, a) = open();
    put(
        &a,
        "My HIV treatment is at the city clinic",
        Level::Domain,
        "recorded",
        &[(META_PRIVATE, "true")],
        None,
    );
    let ctx = a
        .recall("city clinic", None, None, None, None, None)
        .unwrap();
    assert!(ctx.contains("HIV"), "{ctx}");
    assert!(RecallScope::all().include_private);
}
