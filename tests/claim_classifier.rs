//! Host claim classifier overrides the built-in rules, and rules can be off.

use std::sync::Arc;

use aura::experience::ClaimCertainty;
use aura::{Aura, Record};

fn store(aura: &Aura, text: &str) -> Record {
    aura.store(
        text,
        None,
        None,
        None,
        None,
        Some("recorded"),
        None,
        Some(false),
        None,
        None,
        None,
    )
    .unwrap()
}

#[test]
fn host_classifier_wins_and_none_defers_to_rules() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    aura.set_claim_rules_enabled(true);
    aura.set_claim_classifier(Some(Arc::new(|text: &str| {
        text.to_lowercase()
            .contains("per the manual")
            .then_some(ClaimCertainty::Hearsay)
    })));

    let manual = store(&aura, "Per the manual, the API returns at most 100 rows.");
    assert_eq!(manual.metadata["claim_certainty"], "hearsay");

    // Classifier returned None: built-in rules still catch the obvious case.
    let heard = store(&aura, "I heard the office is moving.");
    assert_eq!(heard.metadata["claim_certainty"], "hearsay");
}

#[test]
fn rules_are_off_by_default_so_unclassified_text_keeps_channel_trust() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let heard = store(&aura, "I heard the office is moving.");
    assert!(!heard.metadata.contains_key("claim_certainty"));
    assert_eq!(
        heard.confidence,
        Record::default_confidence_for_source("recorded")
    );
}

#[test]
fn updating_text_reclassifies_it() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    aura.set_claim_rules_enabled(true);
    let rec = store(&aura, "The release ships on Friday.");
    assert_eq!(rec.metadata["claim_certainty"], "asserted");
    let updated = aura
        .update(
            &rec.id,
            Some("They say the release ships on Friday."),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
    assert_eq!(updated.metadata["claim_certainty"], "hearsay");
    assert!(updated.confidence < rec.confidence);
}
