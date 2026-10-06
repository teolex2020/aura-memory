//! A superseding version must be findable by recall at once, not only
//! after the brain is reopened.

use aura::{Aura, Record};

fn store(a: &Aura, text: &str) -> Record {
    a.store_with_channel(
        text,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(false),
        None,
        Some("web"),
        None,
        None,
        None,
    )
    .unwrap()
}

#[test]
fn a_superseding_version_is_recallable_among_similar_records() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    for n in 0..12 {
        store(
            &a,
            &format!("Other{n} Inc's support phone number is +49 30 55500{n:02}."),
        );
    }
    let old = store(&a, "Borel Ltd's support phone number is +49 30 8211507.");
    let new = a
        .supersede(
            &old.id,
            "Borel Ltd changed its support phone number; it is now +49 30 1281668.",
            None,
            None,
            None,
        )
        .unwrap();
    let hits = a
        .recall_structured(
            "What is Borel Ltd's support phone number?",
            Some(8),
            None,
            None,
            None,
            None,
        )
        .unwrap();
    assert!(
        hits.iter().any(|(_, r)| r.id == new.id),
        "new version missing from recall"
    );
    assert!(
        hits.iter().all(|(_, r)| r.id != old.id),
        "old version still recalled"
    );
}
