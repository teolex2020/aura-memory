//! Optional embedding support — pluggable 4th signal for RRF Fusion recall.
//!
//! When an embedding function is provided, embeddings are computed on store
//! and used as an additional ranked list in the recall pipeline.
//! This is optional — Aura works fully without embeddings.

use anyhow::{ensure, Result};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Stores pre-computed embeddings for records.
pub struct EmbeddingStore {
    /// record_id → embedding vector
    embeddings: RwLock<HashMap<String, Vec<f32>>>,
    path: Option<PathBuf>,
    codec: crate::persistence::PersistenceCodec,
}

impl EmbeddingStore {
    pub fn new() -> Self {
        Self {
            embeddings: RwLock::new(HashMap::new()),
            path: None,
            codec: Default::default(),
        }
    }

    pub(crate) fn open(
        root: &Path,
        codec: crate::persistence::PersistenceCodec,
        records: &HashMap<String, crate::record::Record>,
    ) -> Result<Self> {
        let path = root.join("embeddings.cog");
        let mut embeddings: HashMap<String, Vec<f32>> = if path.exists() {
            serde_json::from_slice(&codec.read(&path)?)?
        } else {
            HashMap::new()
        };
        // A crash after the authoritative record deletion cannot resurrect a
        // stale embedding from the last index snapshot.
        embeddings.retain(|id, _| records.contains_key(id));
        let mut dimensions = None;
        for vector in embeddings.values() {
            validate_vector(vector, dimensions)?;
            dimensions = Some(vector.len());
        }
        Ok(Self {
            embeddings: RwLock::new(embeddings),
            path: Some(path),
            codec,
        })
    }

    fn persist(&self, embeddings: &HashMap<String, Vec<f32>>) -> Result<()> {
        if let Some(path) = &self.path {
            self.codec.write(path, &serde_json::to_vec(embeddings)?)?;
        }
        Ok(())
    }

    /// Store an embedding for a record.
    pub fn insert(&self, record_id: &str, embedding: Vec<f32>) -> Result<()> {
        let mut current = self.embeddings.write();
        validate_vector(&embedding, current.values().next().map(Vec::len))?;
        let mut updated = current.clone();
        updated.insert(record_id.to_string(), embedding);
        self.persist(&updated)?;
        *current = updated;
        Ok(())
    }

    /// Remove an embedding.
    pub fn remove(&self, record_id: &str) -> Result<()> {
        let mut current = self.embeddings.write();
        if !current.contains_key(record_id) {
            return Ok(());
        }
        let mut updated = current.clone();
        updated.remove(record_id);
        self.persist(&updated)?;
        *current = updated;
        Ok(())
    }

    /// Check if any embeddings are stored.
    pub fn is_active(&self) -> bool {
        !self.embeddings.read().is_empty()
    }

    /// Number of stored embeddings.
    pub fn len(&self) -> usize {
        self.embeddings.read().len()
    }

    /// Check if empty.
    pub fn is_empty(&self) -> bool {
        self.embeddings.read().is_empty()
    }

    /// Find top-k most similar records to a query embedding via cosine similarity.
    pub fn query(&self, query_embedding: &[f32], top_k: usize) -> Vec<(String, f32)> {
        let store = self.embeddings.read();
        let mut scores: Vec<(String, f32)> = store
            .iter()
            .filter_map(|(rid, emb)| {
                let sim = cosine_similarity(query_embedding, emb);
                if sim > 0.0 {
                    Some((rid.clone(), sim))
                } else {
                    None
                }
            })
            .collect();

        scores.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        scores.truncate(top_k);
        scores
    }

    /// Clear all embeddings.
    pub fn clear(&self) -> Result<()> {
        let mut current = self.embeddings.write();
        self.persist(&HashMap::new())?;
        current.clear();
        Ok(())
    }
}

fn validate_vector(vector: &[f32], dimensions: Option<usize>) -> Result<()> {
    ensure!(
        !vector.is_empty() && vector.iter().all(|v| v.is_finite()),
        "Embedding must be nonempty and finite"
    );
    ensure!(
        dimensions.map_or(true, |d| d == vector.len()),
        "Embedding dimension mismatch"
    );
    Ok(())
}

/// Cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        (dot / denom).max(0.0) // Clamp to non-negative
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepush_equal_embeddings_have_stable_top_k() {
        let expected: Vec<_> = (0..8).map(|i| (format!("record-{i:02}"), 1.0)).collect();
        for reverse in [false, true] {
            let store = EmbeddingStore::new();
            let ids: Vec<_> = if reverse {
                (0..32).rev().collect()
            } else {
                (0..32).collect()
            };
            for i in ids {
                store
                    .insert(&format!("record-{i:02}"), vec![1.0, 0.0])
                    .unwrap();
            }
            assert_eq!(store.query(&[1.0, 0.0], 8), expected);
        }
    }

    #[test]
    fn test_cosine_identical() {
        let a = vec![1.0, 0.0, 1.0];
        assert!((cosine_similarity(&a, &a) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 0.001);
    }

    #[test]
    fn test_cosine_different_length() {
        let a = vec![1.0, 0.0];
        let b = vec![1.0, 0.0, 1.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn test_embedding_store_query() {
        let store = EmbeddingStore::new();
        store.insert("r1", vec![1.0, 0.0, 0.0]).unwrap();
        store.insert("r2", vec![0.9, 0.1, 0.0]).unwrap();
        store.insert("r3", vec![0.0, 0.0, 1.0]).unwrap();

        let results = store.query(&[1.0, 0.0, 0.0], 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "r1"); // Exact match should be first
        assert_eq!(results[1].0, "r2"); // Similar should be second
    }

    #[test]
    fn test_embedding_store_empty() {
        let store = EmbeddingStore::new();
        assert!(!store.is_active());
        assert_eq!(store.query(&[1.0, 0.0], 5).len(), 0);
    }
}
