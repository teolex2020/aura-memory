//! Claim certainty from text: who the claim comes from and how firmly it is held.
//!
//! The write channel (`source_type`) says *who is speaking*. This module reads
//! the text for *what kind of claim* it is:
//!
//! * `Asserted` — first-hand ("I was born on May 12", "I said no");
//! * `Hedged` — first-hand but qualified ("probably", "мабуть");
//! * `Speculative` — explicitly uncertain ("maybe", "може бути");
//! * `Hearsay` — relayed from someone else ("I heard", "кажуть", "my doctor said").
//!
//! A relayed claim is stored faithfully (the user really did say they heard it)
//! but it must not count as first-hand evidence. Matching is on whole words,
//! so `may` does not fire inside `maybe`.

use std::sync::Arc;

use crate::experience::ClaimCertainty;

/// Host-provided claim classifier. Returning `None` defers to the built-in
/// rules (when enabled); otherwise its answer is used as-is.
pub type ClaimClassifier = Arc<dyn Fn(&str) -> Option<ClaimCertainty> + Send + Sync>;

/// Parse a certainty name as returned by a classifier.
pub fn parse(name: &str) -> Option<ClaimCertainty> {
    match name.trim().to_ascii_lowercase().as_str() {
        "asserted" => Some(ClaimCertainty::Asserted),
        "hedged" => Some(ClaimCertainty::Hedged),
        "speculative" => Some(ClaimCertainty::Speculative),
        "hearsay" => Some(ClaimCertainty::Hearsay),
        _ => None,
    }
}

/// Phrases that relay someone else's claim regardless of grammatical subject.
const HEARSAY_PHRASES: &[&str] = &[
    // Ukrainian
    "чув",
    "чула",
    "чули",
    "кажуть",
    "говорять",
    "подейкують",
    "за словами",
    "згідно з",
    "як пишуть",
    "пишуть що",
    "із чуток",
    "з чуток",
    "ходять чутки",
    "нібито",
    "начебто",
    "мені казали",
    "мені сказали",
    "мені розповіли",
    "мені розповідали",
    "нам сказали",
    "нам казали",
    "стверджують",
    "повідомляють",
    // English
    "i heard",
    "we heard",
    "heard that",
    "they say",
    "people say",
    "everyone says",
    "according to",
    "apparently",
    "reportedly",
    "allegedly",
    "rumor",
    "rumour",
    "word is",
    "as per",
    "i was told",
    "we were told",
    "told me",
    "told us",
    "is said to",
];

/// Reporting verbs: hearsay unless the speaker is the grammatical subject.
const SPEECH_VERBS: &[&str] = &[
    // Ukrainian
    "сказав",
    "сказала",
    "сказали",
    "казав",
    "казала",
    "казали",
    "розповів",
    "розповіла",
    "розповідав",
    "розповідала",
    "розповіли",
    "говорив",
    "говорила",
    "пише",
    "писав",
    "писала",
    "повідомив",
    "повідомила",
    "повідомили",
    "стверджує",
    "стверджував",
    // English
    "said",
    "say",
    "says",
    "told",
    "mentioned",
    "wrote",
    "writes",
    "reported",
    "claims",
    "claimed",
];

/// First-person nominative subjects: "I said" is the speaker's own statement.
const FIRST_PERSON: &[&str] = &["я", "ми", "i", "we"];

const SPECULATIVE_PHRASES: &[&str] = &[
    // Ukrainian
    "може бути",
    "можливо",
    "не виключено",
    "не знаю чи",
    "важко сказати",
    "може статися",
    "припускаю",
    "теоретично",
    "якщо пощастить",
    // English
    "maybe",
    "might",
    "could be",
    "possibly",
    "perhaps",
    "not sure",
    "may be",
    "there may",
    "i wonder",
    "hard to say",
    "who knows",
    "theoretically",
];

const HEDGE_PHRASES: &[&str] = &[
    // Ukrainian
    "мабуть",
    "здається",
    "схоже",
    "напевно",
    "ймовірно",
    "скоріш за все",
    "скоріше за все",
    "думаю",
    "вважаю",
    "видно",
    "вочевидь",
    "певно",
    // English
    "probably",
    "likely",
    "seems",
    "it seems",
    "looks",
    "appears",
    "i think",
    "i believe",
    "i guess",
    "i suppose",
    "presumably",
    "chances are",
    "arguably",
];

/// Patterns for first-person biographical facts that belong at Identity level.
const IDENTITY_PHRASES: &[&str] = &[
    "я народився",
    "я народилася",
    "мій день народження",
    "мене звати",
    "моє ім'я",
    "у мене алергія",
    "i was born",
    "my birthday",
    "my name is",
    "i am allergic",
    "i'm allergic",
];

/// Lowercase and reduce to space-separated word tokens, padded for phrase search.
fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push(' ');
    let mut last_space = true;
    for ch in text.chars().flat_map(char::to_lowercase) {
        let keep = ch.is_alphanumeric() || ch == '\'' || ch == '’';
        if keep {
            out.push(if ch == '’' { '\'' } else { ch });
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    if !last_space {
        out.push(' ');
    }
    out
}

fn has_phrase(normalized: &str, phrases: &[&str]) -> bool {
    phrases
        .iter()
        .any(|phrase| normalized.contains(&format!(" {phrase} ")))
}

fn relays_speech(normalized: &str) -> bool {
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    tokens.iter().enumerate().any(|(index, token)| {
        if !SPEECH_VERBS.contains(token) {
            return false;
        }
        // "hard to say" is an infinitive, not a report.
        if index > 0 && tokens[index - 1] == "to" {
            return false;
        }
        let start = index.saturating_sub(2);
        !tokens[start..index]
            .iter()
            .any(|previous| FIRST_PERSON.contains(previous))
    })
}

/// Classify a claim. Hearsay wins over hedging: "my doctor said it might be X"
/// is still a relayed claim.
pub fn classify(text: &str) -> ClaimCertainty {
    let normalized = normalize(text);
    if has_phrase(&normalized, HEARSAY_PHRASES) || relays_speech(&normalized) {
        return ClaimCertainty::Hearsay;
    }
    let starts_with_maybe = normalized.starts_with(" може ");
    if starts_with_maybe || has_phrase(&normalized, SPECULATIVE_PHRASES) {
        return ClaimCertainty::Speculative;
    }
    if has_phrase(&normalized, HEDGE_PHRASES) {
        return ClaimCertainty::Hedged;
    }
    ClaimCertainty::Asserted
}

/// True for a first-hand biographical statement such as a birth date or name.
pub fn is_identity_fact(text: &str) -> bool {
    has_phrase(&normalize(text), IDENTITY_PHRASES)
}

/// Multiplier applied to a record's source confidence for its claim kind.
pub fn confidence_factor(certainty: &ClaimCertainty) -> f32 {
    match certainty {
        ClaimCertainty::Asserted => 1.0,
        ClaimCertainty::Hedged => 0.85,
        ClaimCertainty::Speculative => 0.7,
        ClaimCertainty::Hearsay => 0.7,
    }
}

/// Serialized name stored in record metadata under `claim_certainty`.
pub fn as_str(certainty: &ClaimCertainty) -> &'static str {
    match certainty {
        ClaimCertainty::Asserted => "asserted",
        ClaimCertainty::Hedged => "hedged",
        ClaimCertainty::Speculative => "speculative",
        ClaimCertainty::Hearsay => "hearsay",
    }
}

/// Metadata key holding the computed claim certainty.
pub const META_CLAIM_CERTAINTY: &str = "claim_certainty";

/// Metadata key marking a `recorded` claim relayed by a model (MCP tools).
pub const META_RELAYED_BY_MODEL: &str = "relayed_by_model";

/// Effective evidence label for trust floors: the record's `source_type`,
/// lowered to `inferred` for hearsay/speculative claims and to `retrieved` for
/// model-relayed `recorded` claims.
pub fn effective_source_type(record: &crate::record::Record) -> &str {
    let certainty = record
        .metadata
        .get(META_CLAIM_CERTAINTY)
        .map(String::as_str);
    let relayed = record
        .metadata
        .get(META_RELAYED_BY_MODEL)
        .is_some_and(|value| value == "true");
    let mut label = record.source_type.as_str();
    let rank = crate::ingress::source_type_rank;
    if relayed && rank(label) > rank("retrieved") {
        label = "retrieved";
    }
    if matches!(certainty, Some("hearsay") | Some("speculative")) && rank(label) > rank("inferred")
    {
        label = "inferred";
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_person_speech_is_asserted_third_person_is_hearsay() {
        assert_eq!(
            classify("I said no to the offer."),
            ClaimCertainty::Asserted
        );
        assert_eq!(
            classify("Я сказав, що не прийду."),
            ClaimCertainty::Asserted
        );
        assert_eq!(
            classify("Мама сказала, що прийде."),
            ClaimCertainty::Hearsay
        );
        assert_eq!(
            classify("My friend told me the shop closed."),
            ClaimCertainty::Hearsay
        );
    }

    #[test]
    fn documents_saying_something_is_hearsay_but_hard_to_say_is_not() {
        assert_eq!(
            classify("The docs say the limit is 100."),
            ClaimCertainty::Hearsay
        );
        assert_eq!(
            classify("Hard to say whether it helps."),
            ClaimCertainty::Speculative
        );
        assert_eq!(classify("I say we ship it."), ClaimCertainty::Asserted);
    }

    #[test]
    fn whole_word_matching_avoids_substring_hits() {
        assert_eq!(
            classify("The mayor opened the bridge."),
            ClaimCertainty::Asserted
        );
        assert_eq!(classify("Maybe it is DNS."), ClaimCertainty::Speculative);
    }

    #[test]
    fn identity_facts_are_detected() {
        assert!(is_identity_fact("Я народився 12 травня."));
        assert!(is_identity_fact("I was born in Kyiv."));
        assert!(!is_identity_fact("I heard he was born in Kyiv."));
    }
}
