//! Optional embedding support — pluggable 4th signal for RRF Fusion recall.
//!
//! When an embedding function is provided, embeddings are computed on store
//! and used as an additional ranked list in the recall pipeline.
//! This is optional — Aura works fully without embeddings.

use anyhow::{ensure, Result};
use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Whether a text is stored (a document) or searched for (a query). Many
/// embedding models format the two differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedKind {
    Document,
    Query,
}

/// A native embedding provider (for example a local model server). It
/// returns `None` when it cannot embed a text right now; Aura then works
/// without the embedding signal for that text.
pub trait Embedder: Send + Sync {
    fn embed(&self, text: &str, kind: EmbedKind) -> Option<Vec<f32>>;
}

/// Minimum number of logged inserts before the log is folded into the snapshot.
const MIN_LOG_FRAMES_BEFORE_COMPACTION: usize = 1024;

/// Stores pre-computed embeddings for records.
///
/// Persistence is a snapshot (`embeddings.cog`) plus an append-only insert log
/// (`embeddings.log`). Inserts append one frame instead of rewriting every
/// stored vector; the log is folded into the snapshot once it outgrows it.
/// Removals always rewrite the snapshot and drop the log, so a removed record
/// id never survives in the log (purge relies on this).
pub struct EmbeddingStore {
    /// record_id → embedding vector
    embeddings: RwLock<HashMap<String, Vec<f32>>>,
    path: Option<PathBuf>,
    codec: crate::persistence::PersistenceCodec,
    /// Open append handle and number of frames in the log.
    log: Mutex<(Option<File>, usize)>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LogFrame {
    id: String,
    v: Vec<f32>,
}

impl EmbeddingStore {
    pub fn new() -> Self {
        Self {
            embeddings: RwLock::new(HashMap::new()),
            path: None,
            codec: Default::default(),
            log: Mutex::new((None, 0)),
        }
    }

    fn log_path(path: &Path) -> PathBuf {
        path.with_extension("log")
    }

    /// Replay log frames; stops at the first incomplete or corrupt frame and
    /// returns the byte length of the valid prefix.
    fn replay_log(
        codec: &crate::persistence::PersistenceCodec,
        bytes: &[u8],
        embeddings: &mut HashMap<String, Vec<f32>>,
    ) -> (usize, usize) {
        let mut offset = 0;
        let mut frames = 0;
        while offset + 8 <= bytes.len() {
            let len = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let crc = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
            let end = offset + 8 + len;
            if end > bytes.len() || crc32fast::hash(&bytes[offset + 8..end]) != crc {
                break;
            }
            let Ok(decoded) = codec.decode(&bytes[offset + 8..end]) else {
                break;
            };
            let Ok(frame) = serde_json::from_slice::<LogFrame>(&decoded) else {
                break;
            };
            embeddings.insert(frame.id, frame.v);
            offset = end;
            frames += 1;
        }
        (offset, frames)
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
        let log_path = Self::log_path(&path);
        let mut log_frames = 0;
        if log_path.exists() {
            let mut bytes = Vec::new();
            File::open(&log_path)?.read_to_end(&mut bytes)?;
            let (valid, frames) = Self::replay_log(&codec, &bytes, &mut embeddings);
            log_frames = frames;
            if valid < bytes.len() {
                // Torn tail from a crash mid-append: cut it so later appends
                // are not written after garbage.
                let file = OpenOptions::new().write(true).open(&log_path)?;
                file.set_len(valid as u64)?;
                file.sync_all()?;
            }
        }
        // A crash after the authoritative record deletion cannot resurrect a
        // stale embedding from the last index snapshot.
        embeddings.retain(|id, _| records.contains_key(id));
        let mut dimensions = None;
        for vector in embeddings.values() {
            validate_vector(vector, dimensions)?;
            dimensions = Some(vector.len());
        }
        let store = Self {
            embeddings: RwLock::new(embeddings),
            path: Some(path),
            codec,
            log: Mutex::new((None, log_frames)),
        };
        if log_frames > 0 {
            // Fold the replayed log (and any records filtered above) back into
            // one snapshot so the next session starts from a clean state.
            let current = store.embeddings.read().clone();
            store.persist(&current)?;
        }
        Ok(store)
    }

    /// Rewrite the snapshot atomically and drop the insert log.
    fn persist(&self, embeddings: &HashMap<String, Vec<f32>>) -> Result<()> {
        if let Some(path) = &self.path {
            let mut log = self.log.lock();
            log.0.take();
            self.codec.write(path, &serde_json::to_vec(embeddings)?)?;
            let log_path = Self::log_path(path);
            if log_path.exists() {
                std::fs::remove_file(&log_path)?;
            }
            log.1 = 0;
        }
        Ok(())
    }

    /// Append one insert frame to the log. Returns the frame count after it.
    fn append_log(&self, record_id: &str, embedding: &[f32]) -> Result<usize> {
        let Some(path) = &self.path else {
            return Ok(0);
        };
        let payload = self.codec.encode(&serde_json::to_vec(&LogFrame {
            id: record_id.to_string(),
            v: embedding.to_vec(),
        })?)?;
        let mut frame = Vec::with_capacity(payload.len() + 8);
        frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        frame.extend_from_slice(&crc32fast::hash(&payload).to_le_bytes());
        frame.extend_from_slice(&payload);

        let mut log = self.log.lock();
        if log.0.is_none() {
            log.0 = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(Self::log_path(path))?,
            );
        }
        log.0
            .as_mut()
            .expect("log handle opened above")
            .write_all(&frame)?;
        log.1 += 1;
        Ok(log.1)
    }

    /// Store an embedding for a record.
    pub fn insert(&self, record_id: &str, embedding: Vec<f32>) -> Result<()> {
        let mut current = self.embeddings.write();
        validate_vector(&embedding, current.values().next().map(Vec::len))?;
        // Durable first (append one frame), then publish in memory.
        let frames = self.append_log(record_id, &embedding)?;
        current.insert(record_id.to_string(), embedding);
        if frames > MIN_LOG_FRAMES_BEFORE_COMPACTION.max(current.len()) {
            self.persist(&current)?;
        }
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

    /// Copy of all stored embeddings (for maintenance-time clustering).
    pub fn snapshot(&self) -> HashMap<String, Vec<f32>> {
        self.embeddings.read().clone()
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
