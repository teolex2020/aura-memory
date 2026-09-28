//! E14 (C1, C3): the write channel decides the source type when the caller
//! gives none, so channel-labelled outside text is fenced as untrusted, and
//! the security report flags outside-channel records marked first-hand.

use std::collections::HashMap;

use aura::{Aura, Level};

#[allow(clippy::too_many_arguments)]
fn store(
    a: &Aura,
    text: &str,
    level: Level,
    tags: &[&str],
    source: Option<&str>,
    channel: Option<&str>,
    caused_by: Option<&str>,
    content_type: Option<&str>,
    metadata: Option<HashMap<String, String>>,
) -> String {
    a.store_with_channel(
        text,
        Some(level),
        Some(tags.iter().map(|t| t.to_string()).collect()),
        None,
        content_type,
        source,
        metadata,
        Some(false),
        caused_by,
        channel,
        None,
        None,
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

#[test]
fn channel_decides_source_when_none_is_given() {
    let (_dir, a) = open();
    let cases = [
        ("user", "recorded"),
        ("user-telegram", "recorded"),
        ("system", "recorded"),
        ("agent", "inferred"),
        ("agent-worker", "inferred"),
        ("web_scrape", "retrieved"),
        ("email", "retrieved"),
        ("api", "retrieved"),
    ];
    for (channel, expected) in cases {
        let id = store(
            &a,
            &format!("note written through {channel}"),
            Level::Domain,
            &[],
            None,
            Some(channel),
            None,
            None,
            None,
        );
        let rec = a.get(&id).unwrap();
        assert_eq!(rec.source_type, expected, "{channel}");
        assert_eq!(
            rec.metadata.get("channel").map(String::as_str),
            Some(channel)
        );
    }
    // No channel keeps the default; an explicit source type always wins.
    let plain = store(
        &a,
        "plain note",
        Level::Domain,
        &[],
        None,
        None,
        None,
        None,
        None,
    );
    assert_eq!(a.get(&plain).unwrap().source_type, "recorded");
    let explicit = store(
        &a,
        "forwarded note",
        Level::Domain,
        &[],
        Some("recorded"),
        Some("email"),
        None,
        None,
        None,
    );
    assert_eq!(a.get(&explicit).unwrap().source_type, "recorded");
    let report = a.security_report();
    assert_eq!(report.stats.outside_channel_first_hand, 1);
    assert!(report
        .warnings
        .iter()
        .any(|w| w.contains("outside channel")));
}

#[test]
fn channel_labelled_outside_text_is_fenced_in_provenance_context() {
    let (_dir, a) = open();
    store(
        &a,
        "User is vegan",
        Level::Identity,
        &["food"],
        None,
        Some("user"),
        None,
        None,
        None,
    );
    store(
        &a,
        "User might like steak restaurants",
        Level::Domain,
        &["food"],
        None,
        Some("web_scrape"),
        None,
        None,
        None,
    );
    let context = a
        .recall_provenance(
            "What food does the user like?",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    let (first_hand, untrusted) = context.split_once("[UNTRUSTED MEMORY").expect(&context);
    assert!(first_hand.contains("User is vegan"), "{context}");
    assert!(
        untrusted.contains("│ User might like steak restaurants"),
        "{context}"
    );
    assert!(untrusted.contains("source: web_scrape"), "{context}");
}
