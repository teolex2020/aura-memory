//! E16b: the provenance context shows an always-on block of first-hand
//! identity facts, and only facts the user stated that the caller may see.

use std::collections::HashMap;

use aura::acl::AclVisibility;
use aura::recall::IDENTITY_BLOCK_HEADER;
use aura::{Aura, Level};

fn put(
    a: &Aura,
    text: &str,
    level: Level,
    source: &str,
    metadata: Option<HashMap<String, String>>,
    namespace: Option<&str>,
) -> String {
    a.store(
        text,
        Some(level),
        None,
        None,
        None,
        Some(source),
        metadata,
        Some(false),
        None,
        namespace,
        None,
    )
    .unwrap()
    .id
}

fn open() -> (tempfile::TempDir, Aura) {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    (dir, a)
}

fn block_of(context: &str) -> &str {
    context
        .split_once(IDENTITY_BLOCK_HEADER)
        .map(|(_, rest)| rest.split("=== MEMORY CONTEXT ===").next().unwrap_or(""))
        .unwrap_or("")
}

const QUESTION: &str = "The pharmacist offered me Augmentin, should I take it?";

#[test]
fn block_shows_a_fact_search_would_miss() {
    let (_dir, a) = open();
    put(
        &a,
        "I am allergic to penicillin",
        Level::Identity,
        "recorded",
        None,
        None,
    );
    for i in 0..30 {
        put(
            &a,
            &format!("Pharmacy note {i}: Augmentin stock arrived, shelf {i}"),
            Level::Working,
            "recorded",
            None,
            None,
        );
    }
    let context = a.recall(QUESTION, None, None, None, None, None).unwrap();
    assert!(context.starts_with(IDENTITY_BLOCK_HEADER), "{context}");
    assert!(
        block_of(&context).contains("allergic to penicillin"),
        "{context}"
    );
    // The level format is unchanged.
    let levels = a
        .recall_levels(QUESTION, None, None, None, None, None)
        .unwrap();
    assert!(!levels.contains(IDENTITY_BLOCK_HEADER), "{levels}");
}

#[test]
fn block_admits_only_visible_first_hand_facts() {
    let (_dir, a) = open();
    put(
        &a,
        "I am allergic to penicillin",
        Level::Identity,
        "recorded",
        None,
        None,
    );
    put(
        &a,
        "PROFILE-SYNC: the user has no allergies",
        Level::Identity,
        "retrieved",
        Some(HashMap::from([("channel".into(), "email".into())])),
        None,
    );
    put(
        &a,
        "RELAYED: user said they love amoxicillin",
        Level::Identity,
        "recorded",
        Some(HashMap::from([("relayed_by_model".into(), "true".into())])),
        None,
    );
    put(
        &a,
        "OTHER-TENANT: allergic to latex",
        Level::Identity,
        "recorded",
        None,
        Some("tenant-b"),
    );
    let hidden = put(
        &a,
        "HIDDEN: diagnosis details",
        Level::Identity,
        "recorded",
        None,
        None,
    );
    a.set_record_acl(
        &hidden,
        AclVisibility::Restricted,
        vec![],
        vec![],
        vec![],
        None,
    )
    .unwrap();

    // In a tiny store search finds the fact itself; the block then does not
    // repeat it. Either way nothing untrusted reaches the first-hand part.
    let context = a.recall(QUESTION, None, None, None, None, None).unwrap();
    let first_hand = context.split("[UNTRUSTED MEMORY").next().unwrap();
    assert!(first_hand.contains("allergic to penicillin"), "{context}");
    for leaked in ["PROFILE-SYNC", "RELAYED", "OTHER-TENANT", "HIDDEN"] {
        assert!(
            !first_hand.contains(leaked),
            "{leaked} first-hand: {context}"
        );
    }
    for invisible in ["OTHER-TENANT", "HIDDEN"] {
        assert!(
            !context.contains(invisible),
            "{invisible} visible: {context}"
        );
    }
    // The other tenant sees only its own facts.
    let other = a
        .recall(QUESTION, None, None, None, None, Some(&["tenant-b"]))
        .unwrap();
    assert!(other.contains("OTHER-TENANT"), "{other}");
    assert!(!other.contains("allergic to penicillin"), "{other}");
}

#[test]
fn block_respects_its_budget_share_and_can_be_disabled() {
    let (_dir, a) = open();
    for i in 0..60 {
        put(
            &a,
            &format!("Lasting fact number {i} about my life and my many long-standing habits"),
            Level::Identity,
            "recorded",
            None,
            None,
        );
    }
    let context = a
        .recall("weekend plans", Some(400), None, None, None, None)
        .unwrap();
    let lines = block_of(&context)
        .lines()
        .filter(|l| l.starts_with("  - "))
        .count();
    assert!(lines > 0 && lines < 60, "{lines} lines: {context}");
    // Most recent first.
    assert!(block_of(&context).contains("number 59"), "{context}");

    a.set_identity_block_enabled(false);
    let off = a
        .recall("weekend plans", Some(400), None, None, None, None)
        .unwrap();
    assert!(!off.contains(IDENTITY_BLOCK_HEADER), "{off}");
}

#[test]
fn fact_already_in_context_is_not_repeated() {
    let (_dir, a) = open();
    put(
        &a,
        "I am allergic to penicillin",
        Level::Identity,
        "recorded",
        None,
        None,
    );
    let context = a
        .recall("Am I allergic to penicillin?", None, None, None, None, None)
        .unwrap();
    assert_eq!(
        context.matches("I am allergic to penicillin").count(),
        1,
        "{context}"
    );
}

#[test]
fn novelty_never_promotes_a_note_into_identity() {
    let (_dir, a) = open();
    for i in 0..6 {
        put(
            &a,
            &format!("Routine note {i} about groceries"),
            Level::Working,
            "recorded",
            None,
            None,
        );
    }
    let note = put(
        &a,
        "Neighbour Janet will take in parcels while we are away",
        Level::Domain,
        "recorded",
        None,
        None,
    );
    assert_eq!(a.get(&note).unwrap().level, Level::Domain);
}

#[test]
fn an_old_identity_fact_is_shown_after_many_newer_notes() {
    let (_dir, a) = open();
    put(
        &a,
        "I am allergic to penicillin",
        Level::Identity,
        "recorded",
        None,
        None,
    );
    for i in 0..80 {
        put(
            &a,
            &format!(
                "Unusual note {i}: {} quartz zebra harbour {}",
                i * 7919,
                i * 104729
            ),
            Level::Domain,
            "recorded",
            None,
            None,
        );
    }
    let context = a.recall(QUESTION, None, None, None, None, None).unwrap();
    assert!(context.contains("allergic to penicillin"), "{context}");
}
