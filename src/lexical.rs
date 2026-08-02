//! Lightweight in-memory BM25 index for exact lexical recall.
//!
//! This complements Aura's SDR and fuzzy N-gram signals. It intentionally has
//! no external search-engine dependency, keeping the embedded build small.

use std::collections::{HashMap, HashSet};

use crate::record::Record;

const BM25_K1: f32 = 1.2;
const BM25_B: f32 = 0.75;

#[derive(Debug, Clone, Default)]
struct LexicalDocument {
    term_frequencies: HashMap<String, u32>,
    length: usize,
    namespace: String,
}

/// Mutable BM25 index maintained alongside the existing SDR/N-gram indices.
#[derive(Debug, Default)]
pub struct LexicalIndex {
    documents: HashMap<String, LexicalDocument>,
    postings: HashMap<String, HashSet<String>>,
    total_document_length: usize,
    namespace_document_counts: HashMap<String, usize>,
    namespace_total_lengths: HashMap<String, usize>,
}

impl LexicalIndex {
    pub fn from_records(records: &HashMap<String, Record>) -> Self {
        let mut index = Self::default();
        for record in records.values() {
            index.add(&record.id, &record.content, &record.namespace);
        }
        index
    }

    pub fn add(&mut self, record_id: &str, content: &str, namespace: &str) {
        self.remove(record_id);

        let tokens = tokenize(content);
        if tokens.is_empty() {
            return;
        }

        let mut term_frequencies = HashMap::new();
        for token in &tokens {
            *term_frequencies.entry(token.clone()).or_insert(0) += 1;
        }
        for term in term_frequencies.keys() {
            self.postings
                .entry(term.clone())
                .or_default()
                .insert(record_id.to_string());
        }

        self.total_document_length += tokens.len();
        *self
            .namespace_document_counts
            .entry(namespace.to_string())
            .or_insert(0) += 1;
        *self
            .namespace_total_lengths
            .entry(namespace.to_string())
            .or_insert(0) += tokens.len();
        self.documents.insert(
            record_id.to_string(),
            LexicalDocument {
                term_frequencies,
                length: tokens.len(),
                namespace: namespace.to_string(),
            },
        );
    }

    pub fn remove(&mut self, record_id: &str) -> bool {
        let Some(document) = self.documents.remove(record_id) else {
            return false;
        };

        self.total_document_length = self.total_document_length.saturating_sub(document.length);
        if let Some(count) = self.namespace_document_counts.get_mut(&document.namespace) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.namespace_document_counts.remove(&document.namespace);
            }
        }
        if let Some(length) = self.namespace_total_lengths.get_mut(&document.namespace) {
            *length = length.saturating_sub(document.length);
            if *length == 0 {
                self.namespace_total_lengths.remove(&document.namespace);
            }
        }
        for term in document.term_frequencies.keys() {
            let remove_posting = if let Some(ids) = self.postings.get_mut(term) {
                ids.remove(record_id);
                ids.is_empty()
            } else {
                false
            };
            if remove_posting {
                self.postings.remove(term);
            }
        }
        true
    }

    pub fn search(
        &self,
        query: &str,
        top_k: usize,
        records: &HashMap<String, Record>,
        namespaces: &[&str],
    ) -> Vec<(String, f32)> {
        if top_k == 0 || self.documents.is_empty() {
            return Vec::new();
        }

        let query_terms: HashSet<String> = tokenize(query).into_iter().collect();
        if query_terms.is_empty() {
            return Vec::new();
        }

        let document_count = namespaces
            .iter()
            .map(|namespace| {
                self.namespace_document_counts
                    .get(*namespace)
                    .copied()
                    .unwrap_or(0)
            })
            .sum::<usize>() as f32;
        if document_count == 0.0 {
            return Vec::new();
        }
        let total_length = namespaces
            .iter()
            .map(|namespace| {
                self.namespace_total_lengths
                    .get(*namespace)
                    .copied()
                    .unwrap_or(0)
            })
            .sum::<usize>();
        let average_length = (total_length as f32 / document_count).max(1.0);
        let mut scores: HashMap<String, f32> = HashMap::new();

        for term in query_terms {
            let Some(posting) = self.postings.get(&term) else {
                continue;
            };
            let document_frequency = posting
                .iter()
                .filter(|record_id| {
                    self.documents
                        .get(*record_id)
                        .is_some_and(|document| namespaces.contains(&document.namespace.as_str()))
                })
                .count() as f32;
            if document_frequency == 0.0 {
                continue;
            }
            let inverse_document_frequency = (1.0
                + (document_count - document_frequency + 0.5) / (document_frequency + 0.5))
                .ln();

            for record_id in posting {
                let Some(record) = records.get(record_id) else {
                    continue;
                };
                if !namespaces.contains(&record.namespace.as_str()) {
                    continue;
                }
                let Some(document) = self.documents.get(record_id) else {
                    continue;
                };
                let term_frequency =
                    document.term_frequencies.get(&term).copied().unwrap_or(0) as f32;
                let length_ratio = document.length as f32 / average_length;
                let denominator = term_frequency + BM25_K1 * (1.0 - BM25_B + BM25_B * length_ratio);
                let score = inverse_document_frequency
                    * (term_frequency * (BM25_K1 + 1.0) / denominator.max(f32::EPSILON));
                *scores.entry(record_id.clone()).or_insert(0.0) += score;
            }
        }

        let mut ranked: Vec<(String, f32)> = scores.into_iter().collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });
        ranked.truncate(top_k);
        ranked
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric() && character != '_')
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    #[test]
    fn exact_rare_term_ranks_first() {
        let mut records = HashMap::new();
        let common = Record::new("deployment completed successfully".into(), Level::Working);
        let rare = Record::new("deployment failed with ERR_AUTH_431".into(), Level::Working);
        records.insert(common.id.clone(), common);
        records.insert(rare.id.clone(), rare.clone());

        let index = LexicalIndex::from_records(&records);
        let results = index.search("ERR_AUTH_431", 5, &records, &["default"]);

        assert_eq!(
            results.first().map(|item| item.0.as_str()),
            Some(rare.id.as_str())
        );
        assert!(results[0].1 > 0.0);
    }

    #[test]
    fn search_is_namespace_safe() {
        let mut default_record = Record::new("private invoice 431".into(), Level::Working);
        default_record.namespace = "default".into();
        let mut tenant_record = Record::new("private invoice 431".into(), Level::Working);
        tenant_record.namespace = "tenant-b".into();

        let mut records = HashMap::new();
        records.insert(default_record.id.clone(), default_record.clone());
        records.insert(tenant_record.id.clone(), tenant_record.clone());
        let index = LexicalIndex::from_records(&records);

        let results = index.search("invoice 431", 5, &records, &["tenant-b"]);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, tenant_record.id);
    }

    #[test]
    fn replacement_removes_old_terms() {
        let mut index = LexicalIndex::default();
        index.add("record-1", "legacy_token", "default");
        index.add("record-1", "current_token", "default");

        let mut records = HashMap::new();
        records.insert(
            "record-1".into(),
            Record::new("current_token".into(), Level::Working),
        );
        records.get_mut("record-1").unwrap().id = "record-1".into();

        assert!(index
            .search("legacy_token", 5, &records, &["default"])
            .is_empty());
        assert_eq!(index.document_count(), 1);
    }
}
