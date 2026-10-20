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

#[test]
fn this_conversation_is_left_out_when_asked() {
    let (_d, a) = open();
    put(
        &a,
        "Orchid staging listens on port 7311",
        Level::Domain,
        "recorded",
        &[("session_id", "s-old")],
        None,
    );
    put(
        &a,
        "Orchid staging port question again",
        Level::Domain,
        "recorded",
        &[("session_id", "s-now")],
        None,
    );
    let q = "Orchid staging port";
    let all = a
        .recall_provenance_scoped(q, None, &RecallScope::default())
        .unwrap();
    assert!(
        all.contains("7311") && all.contains("question again"),
        "{all}"
    );
    let other = RecallScope {
        exclude_session: Some("s-now".into()),
        ..RecallScope::default()
    };
    let earlier = a.recall_provenance_scoped(q, None, &other).unwrap();
    assert!(earlier.contains("7311"), "{earlier}");
    assert!(!earlier.contains("question again"), "{earlier}");
}

#[test]
fn memory_map_counts_what_the_scope_allows() {
    let (_d, a) = open();
    assert_eq!(a.memory_map(&RecallScope::default(), 8), "");
    put(
        &a,
        "Orchid staging listens on port 7311",
        Level::Domain,
        "recorded",
        &[("project", "Orchid")],
        None,
    );
    put(
        &a,
        "Orchid deploys from rel/green",
        Level::Domain,
        "recorded",
        &[("project", "Orchid")],
        None,
    );
    put(
        &a,
        "A page said Orchid uses port 8080",
        Level::Domain,
        "retrieved",
        &[("project", "Orchid")],
        None,
    );
    put(
        &a,
        "My clinic visit is on Friday",
        Level::Domain,
        "recorded",
        &[(META_PRIVATE, "true")],
        None,
    );
    let map = a.memory_map(&RecallScope::default(), 8);
    assert!(map.starts_with(aura::recall::MEMORY_MAP_LEAD), "{map}");
    assert!(
        map.contains("- Orchid project: 3 notes (2 from the user)"),
        "{map}"
    );
    assert!(
        !map.contains("other notes"),
        "a private topic is not shown to a cloud app: {map}"
    );
    let local = RecallScope {
        include_private: true,
        ..RecallScope::default()
    };
    assert!(a
        .memory_map(&local, 8)
        .contains("- other notes: 1 note (from the user)"));
}

/// E112: with the agent's project in the scope, the project's own best
/// record is shown even when other projects' records outrank it globally,
/// and other projects' records still fill the rest of the budget.
#[test]
fn project_records_get_a_share_without_hiding_other_projects() {
    let (_d, a) = open();
    for n in 0..30 {
        put(
            &a,
            &format!("We deploy the release branch every Friday for service {n}"),
            Level::Working,
            "recorded",
            &[("project", &format!("other{n}"))],
            None,
        );
    }
    put(
        &a,
        "Lark ships from rel/green now",
        Level::Working,
        "recorded",
        &[("project", "lark")],
        None,
    );
    let q = "which release branch do we deploy";
    let budget = Some(120);
    let global = a.recall_provenance_scoped(q, budget, &cloud()).unwrap();
    assert!(!global.contains("rel/green"), "{global}");
    let in_lark = RecallScope {
        project: Some("lark".into()),
        ..cloud()
    };
    let with_project = a.recall_provenance_scoped(q, budget, &in_lark).unwrap();
    assert!(with_project.contains("rel/green"), "{with_project}");
    assert!(with_project.contains("for service"), "{with_project}");
    // a project with no records of its own changes nothing
    let empty = RecallScope {
        project: Some("nowhere".into()),
        ..cloud()
    };
    assert_eq!(
        a.recall_provenance_scoped(q, budget, &empty).unwrap(),
        global
    );
}
