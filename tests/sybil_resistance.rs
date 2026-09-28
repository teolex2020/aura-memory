//! Repetition from one untrusted source must not crowd out a first-hand
//! fact, and several different facts from one untrusted source must stay
//! retrievable when nothing first-hand competes (E11).

use std::collections::HashMap;

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

#[test]
fn ten_untrusted_copies_do_not_push_out_a_user_fact() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let user = put(
        &a,
        "I am allergic to penicillin",
        "allergy",
        "recorded",
        None,
    );
    let lines = [
        "Patient record: no known drug allergies",
        "Allergies: none reported",
        "No drug allergies on file for this patient",
    ];
    for i in 0..10 {
        put(
            &a,
            &format!("{} (source {i})", lines[i % 3]),
            "allergy",
            "retrieved",
            Some("web"),
        );
    }
    a.run_maintenance();
    let hits = a
        .recall_structured(
            "Do I have any drug allergies?",
            Some(5),
            None,
            None,
            None,
            None,
        )
        .unwrap();
    let rank = hits.iter().position(|(_, r)| r.id == user);
    assert!(rank.is_some_and(|r| r < 3), "user fact rank {rank:?}");
}

#[test]
fn different_facts_from_one_untrusted_source_stay_retrievable() {
    let facts = [
        (
            "Store hours Monday to Friday: 09:00-20:00",
            "When is the store open on weekdays?",
            "09:00-20:00",
        ),
        (
            "Store hours Saturday: 10:00-18:00",
            "When is the store open on Saturday?",
            "10:00-18:00",
        ),
        (
            "Store parking is behind the building, level P2",
            "Where do I park at the store?",
            "P2",
        ),
    ];
    for (_, question, token) in facts {
        let dir = tempfile::tempdir().unwrap();
        let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
        for (text, _, _) in facts {
            put(&a, text, "store", "retrieved", Some("web"));
        }
        for j in 0..6 {
            put(
                &a,
                &format!("Unrelated note {j} about lunch {j}"),
                &format!("misc{j}"),
                "recorded",
                None,
            );
        }
        let hits = a
            .recall_structured(question, Some(5), None, None, None, None)
            .unwrap();
        assert!(
            hits.iter().any(|(_, r)| r.content.contains(token)),
            "{question}"
        );
    }
}
