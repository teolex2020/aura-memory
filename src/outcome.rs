//! Outcome polarity from structured signals, not words.
//!
//! Whether an effect was good or bad decides if advice says "avoid" or
//! "prefer". Reading that from keywords only works in the languages (and
//! phrasings) a word list happens to cover, so polarity comes from signals
//! that mean the same thing in every language:
//!
//! 1. consequence tags written by `capture_consequence` (support / refute);
//! 2. `metadata.outcome` = `positive` | `negative`, set by the host or by an
//!    optional outcome classifier at write time;
//! 3. `semantic_type = "contradiction"`.
//!
//! Records without any of these are neutral.

use std::sync::Arc;

use crate::record::Record;

/// Metadata key holding a record's outcome polarity.
pub const META_OUTCOME: &str = "outcome";

/// Polarity of an effect record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Positive,
    Negative,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "positive" => Some(Self::Positive),
            "negative" => Some(Self::Negative),
            _ => None,
        }
    }
}

/// Host-provided outcome classifier, run at write time without Aura's locks.
/// Returning `None` leaves the record neutral.
pub type OutcomeClassifier = Arc<dyn Fn(&str) -> Option<Outcome> + Send + Sync>;

/// (positive, negative) signal weight contributed by one record.
pub fn record_signals(record: &Record) -> (usize, usize) {
    let mut positive = 0;
    let mut negative = 0;
    for tag in &record.tags {
        match tag.as_str() {
            crate::consequence::CONSEQUENCE_SUPPORT_TAG => positive += 1,
            crate::consequence::CONSEQUENCE_REFUTE_TAG => negative += 1,
            _ => {}
        }
    }
    match record
        .metadata
        .get(META_OUTCOME)
        .and_then(|value| Outcome::parse(value))
    {
        Some(Outcome::Positive) => positive += 1,
        Some(Outcome::Negative) => negative += 1,
        None => {}
    }
    if record.semantic_type == "contradiction" {
        negative += 2;
    }
    (positive, negative)
}

/// Sum of signals over a set of effect records.
pub fn signal_counts<'a>(records: impl IntoIterator<Item = &'a Record>) -> (usize, usize) {
    records
        .into_iter()
        .map(record_signals)
        .fold((0, 0), |(p, n), (dp, dn)| (p + dp, n + dn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    fn record(outcome: Option<&str>, tags: &[&str]) -> Record {
        let mut r = Record::new(
            "Після релізу платежі лежали дві години".into(),
            Level::Domain,
        );
        r.tags = tags.iter().map(|t| t.to_string()).collect();
        if let Some(o) = outcome {
            r.metadata.insert(META_OUTCOME.into(), o.into());
        }
        r
    }

    #[test]
    fn text_alone_carries_no_polarity() {
        assert_eq!(
            record_signals(&record(None, &["outage", "failure"])),
            (0, 0)
        );
    }

    #[test]
    fn structured_signals_set_polarity_in_any_language() {
        assert_eq!(record_signals(&record(Some("negative"), &[])), (0, 1));
        assert_eq!(record_signals(&record(Some("positive"), &[])), (1, 0));
        assert_eq!(
            record_signals(&record(None, &["consequence-refute"])),
            (0, 1)
        );
        assert_eq!(record_signals(&record(Some("bogus"), &[])), (0, 0));
    }
}
