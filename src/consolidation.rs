//! MinHash deduplication & merge.
//!
//! Rewritten from aura-cognitive memory.py consolidate().

use crate::cognitive_store::CognitiveStore;
use crate::graph;
use crate::ngram::NGramIndex;
use crate::record::Record;
use std::collections::{HashMap, HashSet};

/// Hard merge threshold — no LLM needed.
pub const CONSOLIDATION_THRESHOLD: f32 = 0.85;
/// Soft merge threshold — LLM-assisted range.
pub const CONSOLIDATION_SOFT_THRESHOLD: f32 = 0.5;

/// Result of a consolidation run.
#[derive(Debug, Default)]
pub struct ConsolidationResult {
    pub merged: usize,
    pub checked: usize,
    /// Records merged away; callers must drop them from derived indexes.
    pub merged_ids: Vec<String>,
}

/// Run hard-merge consolidation (MinHash >= 0.85).
///
/// Finds duplicate pairs, keeps the higher-importance record,
/// merges tags/connections/strength from the other.
pub fn consolidate(
    records: &mut HashMap<String, Record>,
    ngram_index: &mut NGramIndex,
    tag_index: &mut HashMap<String, HashSet<String>>,
    aura_index: &mut HashMap<String, String>,
    store: &CognitiveStore,
) -> ConsolidationResult {
    let mut result = ConsolidationResult::default();

    // Build namespace lookup for O(1) filtering
    let ns_map: HashMap<&str, &str> = records
        .iter()
        .map(|(id, r)| (id.as_str(), r.namespace.as_str()))
        .collect();

    // Find similar pairs (global MinHash) and pre-filter to same-namespace only
    let all_pairs = ngram_index.find_similar_pairs(CONSOLIDATION_THRESHOLD);
    let pairs: Vec<_> = all_pairs
        .into_iter()
        .filter(|(id_a, id_b, _)| ns_map.get(id_a.as_str()) == ns_map.get(id_b.as_str()))
        .collect();
    result.checked = pairs.len();

    // Process pairs (avoid double-processing)
    let mut removed: HashSet<String> = HashSet::new();

    for (id_a, id_b, _sim) in &pairs {
        if removed.contains(id_a) || removed.contains(id_b) {
            continue;
        }

        // Textual similarity is not semantic equivalence. Corrections and
        // contradictions often differ by only one negation (for example,
        // "requires staging" vs "no longer requires staging"). Never let the
        // approximate MinHash pass collapse an explicitly conflicting pair.
        if records_are_explicitly_conflicting(records, id_a, id_b) {
            continue;
        }

        let imp_a = records.get(id_a).map(|r| r.importance()).unwrap_or(0.0);
        let imp_b = records.get(id_b).map(|r| r.importance()).unwrap_or(0.0);

        let scar_a = records
            .get(id_a)
            .map(|r| r.route_state_class() == crate::record::RouteStateClass::Refuted)
            .unwrap_or(false);
        let scar_b = records
            .get(id_b)
            .map(|r| r.route_state_class() == crate::record::RouteStateClass::Refuted)
            .unwrap_or(false);

        // Scar protection: a Refuted consequence scar must never be the record
        // that gets removed in a merge — its record_id and consequence metadata
        // (situation/action/trust) must survive so consequence_verdict still sees
        // it. If BOTH sides are scars, leave them both untouched (merging would
        // destroy one scar's lived record).
        let (keep_id, remove_id) = if scar_a && scar_b {
            continue;
        } else if scar_a {
            (id_a.clone(), id_b.clone()) // keep the scar
        } else if scar_b {
            (id_b.clone(), id_a.clone()) // keep the scar
        } else if imp_a >= imp_b {
            (id_a.clone(), id_b.clone())
        } else {
            (id_b.clone(), id_a.clone())
        };

        // MinHash similarity is not equivalence: two facts that differ only by
        // an identifier, number or negation look near-identical. Merge only
        // when the removed record adds no information to the kept one; flip the
        // direction when that preserves everything, otherwise keep both.
        let (keep_id, remove_id) = match (records.get(&keep_id), records.get(&remove_id)) {
            (Some(keep), Some(remove)) if merge_preserves_content(keep, remove) => {
                (keep_id, remove_id)
            }
            (Some(keep), Some(remove))
                if !scar_a && !scar_b && merge_preserves_content(remove, keep) =>
            {
                (remove_id, keep_id)
            }
            _ => continue,
        };

        match graph::merge_records(
            &keep_id,
            &remove_id,
            records,
            ngram_index,
            tag_index,
            aura_index,
            store,
        ) {
            Ok(()) => {
                result.merged_ids.push(remove_id.clone());
                removed.insert(remove_id);
                result.merged += 1;
            }
            Err(error) => {
                tracing::error!(
                    record_id = %remove_id,
                    %error,
                    "consolidation merge tombstone failed; record remains visible"
                );
            }
        }
    }

    result
}

const NEGATIONS: &[&str] = &[
    "not", "no", "never", "none", "nothing", "without", "cannot", "nor", "dont", "don", "doesnt",
    "doesn", "didnt", "didn", "isnt", "isn", "arent", "aren", "wasnt", "wasn", "werent", "weren",
    "wont", "won", "shouldnt", "shouldn", "mustnt", "mustn", "cant",
];

fn content_tokens(text: &str) -> HashSet<String> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// True when merging `remove` into `keep` loses no words, numbers or
/// identifiers, and both records agree on negation.
fn merge_preserves_content(keep: &Record, remove: &Record) -> bool {
    let keep_tokens = content_tokens(&keep.content);
    let remove_tokens = content_tokens(&remove.content);
    let negations = |tokens: &HashSet<String>| -> HashSet<String> {
        tokens
            .iter()
            .filter(|token| NEGATIONS.contains(&token.as_str()))
            .cloned()
            .collect()
    };
    remove_tokens.is_subset(&keep_tokens) && negations(&keep_tokens) == negations(&remove_tokens)
}

fn records_are_explicitly_conflicting(
    records: &HashMap<String, Record>,
    id_a: &str,
    id_b: &str,
) -> bool {
    [
        records
            .get(id_a)
            .and_then(|record| record.connection_type(id_b)),
        records
            .get(id_b)
            .and_then(|record| record.connection_type(id_a)),
    ]
    .into_iter()
    .flatten()
    .any(|relation| {
        let relation = relation.to_ascii_lowercase();
        relation.contains("contradict")
            || relation.contains("conflict")
            || relation.contains("refut")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    #[test]
    fn test_consolidation_threshold() {
        assert!(CONSOLIDATION_THRESHOLD > CONSOLIDATION_SOFT_THRESHOLD);
        assert!(CONSOLIDATION_THRESHOLD <= 1.0);
    }

    #[test]
    fn merge_requires_that_no_content_is_lost() {
        let fact = |text: &str| Record::new(text.into(), Level::Domain);
        let a = fact("Rollback plan 12 for BENIGN_12_TOKEN is reviewed before rollout.");
        let b = fact("Rollback plan 13 for BENIGN_13_TOKEN is reviewed before rollout.");
        assert!(!merge_preserves_content(&a, &b));
        assert!(!merge_preserves_content(&b, &a));

        let short = fact("User prefers dark mode");
        let long = fact("The user prefers dark mode.");
        assert!(merge_preserves_content(&long, &short));
        assert!(!merge_preserves_content(&short, &long));

        let positive = fact("Deploy on Friday after staging");
        let negative = fact("Do not deploy on Friday after staging");
        assert!(!merge_preserves_content(&negative, &positive));
    }

    #[test]
    fn distinct_facts_with_shared_wording_survive_consolidation() {
        let dir = tempfile::tempdir().unwrap();
        let store = CognitiveStore::new(dir.path()).unwrap();
        let mut records = HashMap::new();
        let mut ngram = NGramIndex::new(None, None);
        let mut tag_index = HashMap::new();
        let mut aura_index = HashMap::new();
        for i in 0..20 {
            let rec = Record::new(
                format!(
                    "Deployment runbook fact BENIGN_{i}_TOKEN: staging checks pass before production rollout, health gate stays enabled, rollback plan {i} is reviewed."
                ),
                Level::Domain,
            );
            ngram.add(&rec.id, &rec.content);
            store.append_store(&rec).unwrap();
            records.insert(rec.id.clone(), rec);
        }
        let result = consolidate(
            &mut records,
            &mut ngram,
            &mut tag_index,
            &mut aura_index,
            &store,
        );
        assert_eq!(result.merged, 0);
        assert_eq!(records.len(), 20);
    }

    #[test]
    fn explicit_conflicts_are_never_merged_as_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let store = CognitiveStore::new(directory.path()).unwrap();
        let mut records = HashMap::new();
        let mut ngram = NGramIndex::new(None, None);
        let mut tag_index = HashMap::new();
        let mut aura_index = HashMap::new();

        let mut old = Record::new("deployment policy requires staging".into(), Level::Identity);
        let mut correction = Record::new(
            "deployment policy requires staging".into(),
            Level::Decisions,
        );
        old.add_typed_connection(&correction.id, 1.0, "contradicts");
        correction.add_typed_connection(&old.id, 1.0, "contradicts");

        let old_id = old.id.clone();
        let correction_id = correction.id.clone();
        ngram.add(&old_id, &old.content);
        ngram.add(&correction_id, &correction.content);
        records.insert(old_id.clone(), old);
        records.insert(correction_id.clone(), correction);

        let result = consolidate(
            &mut records,
            &mut ngram,
            &mut tag_index,
            &mut aura_index,
            &store,
        );

        assert_eq!(result.checked, 1);
        assert_eq!(result.merged, 0);
        assert!(records.contains_key(&old_id));
        assert!(records.contains_key(&correction_id));
    }
}
