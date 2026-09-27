//! Cognitive binary storage — append-only log with snapshots.
//!
//! Rewritten from aura-cognitive store.py.
//! Format: COG1 header → [OP(1B) | payload_len(4B) | CRC32(4B) | payload]...

use anyhow::{anyhow, Result};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

use crate::record::Record;

const MAGIC: &[u8; 4] = b"COG1";
const VERSION: u8 = 2;

const OP_STORE: u8 = 0x01;
const OP_UPDATE: u8 = 0x02;
const OP_DELETE: u8 = 0x03;
/// One CRC-protected frame containing multiple record upserts. Replay applies
/// the complete vector or none of it, which makes version-chain replacement
/// atomic in the authoritative cognitive journal.
const OP_ATOMIC_UPSERTS: u8 = 0x04;
/// Compact atomic patches for reserved metadata and typed connections. This
/// avoids rewriting an entire record when a small audit edge is appended.
const OP_ATOMIC_RECORD_PATCHES: u8 = 0x05;
/// One CRC-protected frame containing a complete lifecycle transition. Replay
/// applies every upsert and deletion together, so maintenance cannot expose a
/// partially persisted decay/archive decision after restart.
const OP_ATOMIC_MUTATIONS: u8 = 0x06;

const SNAP_MAGIC: &[u8; 4] = b"CSN1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct TypedConnectionPatch {
    #[serde(rename = "i")]
    pub other_record_id: String,
    #[serde(rename = "w")]
    pub weight: f32,
    #[serde(rename = "r")]
    pub relationship: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct RecordPatch {
    #[serde(rename = "i")]
    pub record_id: String,
    #[serde(rename = "m", default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata_upserts: HashMap<String, String>,
    #[serde(rename = "c", default, skip_serializing_if = "Vec::is_empty")]
    pub typed_connection_upserts: Vec<TypedConnectionPatch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct CognitiveMutationBatch {
    #[serde(rename = "u", default, skip_serializing_if = "Vec::is_empty")]
    upserts: Vec<Record>,
    #[serde(rename = "d", default, skip_serializing_if = "Vec::is_empty")]
    deletes: Vec<String>,
}

/// Append-only cognitive record storage with snapshot-accelerated loading.
pub struct CognitiveStore {
    #[allow(dead_code)]
    path: PathBuf,
    log_path: PathBuf,
    snap_path: PathBuf,
    writer: Mutex<Option<BufWriter<File>>>,
    log_position: Mutex<u64>,
    codec: crate::persistence::PersistenceCodec,
    #[cfg(test)]
    fail_next_atomic_upsert: AtomicBool,
}

impl CognitiveStore {
    /// Open or create a cognitive store at the given directory.
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        Self::with_codec(path, crate::persistence::PersistenceCodec::default())
    }

    pub(crate) fn with_codec<P: AsRef<Path>>(
        path: P,
        codec: crate::persistence::PersistenceCodec,
    ) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        fs::create_dir_all(&path)?;

        let log_path = path.join("brain.cog");
        let snap_path = path.join("brain.snap");

        // Initialize log file if it doesn't exist
        if !log_path.exists() {
            let mut f = File::create(&log_path)?;
            f.write_all(MAGIC)?;
            f.write_u8(if codec.is_encrypted() { 3 } else { VERSION })?;
            f.flush()?;
        } else {
            let mut file = File::open(&log_path)?;
            let mut magic = [0; 4];
            file.read_exact(&mut magic)?;
            let version = file.read_u8()?;
            anyhow::ensure!(
                &magic == MAGIC && (version == VERSION || version == 3),
                "Unsupported cognitive journal format"
            );
            anyhow::ensure!((version == 3) == codec.is_encrypted(), "Cognitive journal encryption mode mismatch; password or explicit migration required");
        }

        let writer_file = OpenOptions::new().append(true).open(&log_path)?;
        let writer = BufWriter::new(writer_file);

        Ok(Self {
            path,
            log_path,
            snap_path,
            writer: Mutex::new(Some(writer)),
            log_position: Mutex::new(0),
            codec,
            #[cfg(test)]
            fail_next_atomic_upsert: AtomicBool::new(false),
        })
    }

    /// Load all records from snapshot + log replay.
    pub fn load_all(&self) -> Result<HashMap<String, Record>> {
        let (records, snap_end_pos) = self.load_from_disk()?;
        *self.log_position.lock() = snap_end_pos;
        Ok(records)
    }

    fn load_from_disk(&self) -> Result<(HashMap<String, Record>, u64)> {
        const LOG_START: u64 = 5; // magic(4) + version(1)
        let mut records = HashMap::new();
        let log_len = fs::metadata(&self.log_path)?.len();

        // 1. Load snapshot if exists
        let snap_end_pos = if self.snap_path.exists() {
            match self.load_snapshot(&mut records) {
                // A snapshot pointing past the end of the log belongs to a
                // different log generation; trust the log instead.
                Ok(pos) if pos <= log_len => pos,
                Ok(pos) => {
                    tracing::warn!(
                        "Cognitive snapshot position {} exceeds log length {}. Replaying log from start.",
                        pos,
                        log_len
                    );
                    records.clear();
                    LOG_START
                }
                Err(err) => {
                    tracing::warn!(
                        "Failed to load cognitive snapshot from {:?}: {}. Falling back to log replay from start.",
                        self.snap_path,
                        err
                    );
                    records.clear();
                    LOG_START
                }
            }
        } else {
            LOG_START
        };

        // 2. Replay log entries after snapshot position
        self.replay_log(&mut records, snap_end_pos)?;

        Ok((records, snap_end_pos))
    }

    /// Load records from snapshot file.
    fn load_snapshot(&self, records: &mut HashMap<String, Record>) -> Result<u64> {
        let mut reader = BufReader::new(File::open(&self.snap_path)?);

        // Verify magic
        let mut magic = [0u8; 4];
        reader.read_exact(&mut magic)?;
        if &magic != SNAP_MAGIC {
            return Err(anyhow!("Invalid snapshot magic"));
        }

        let _version = reader.read_u8()?;
        let log_position = reader.read_u64::<LittleEndian>()?;
        let record_count = reader.read_u32::<LittleEndian>()?;

        for _ in 0..record_count {
            let payload_len = reader.read_u32::<LittleEndian>()? as usize;
            let mut payload = vec![0u8; payload_len];
            reader.read_exact(&mut payload)?;

            let payload = self.codec.decode(&payload)?;
            if let Ok(rec) = self.deserialize_record(&payload) {
                records.insert(rec.id.clone(), rec);
            }
        }

        Ok(log_position)
    }

    /// Replay log entries starting from the given position.
    fn replay_log(&self, records: &mut HashMap<String, Record>, start_pos: u64) -> Result<()> {
        let file = File::open(&self.log_path)?;
        let file_len = file.metadata()?.len();
        let mut reader = BufReader::new(file);
        reader.seek(SeekFrom::Start(start_pos))?;

        while reader.stream_position()? < file_len {
            let op = match reader.read_u8() {
                Ok(op) => op,
                Err(_) => break,
            };

            let payload_len = match reader.read_u32::<LittleEndian>() {
                Ok(len) => len as usize,
                Err(_) => break,
            };

            let expected_crc = match reader.read_u32::<LittleEndian>() {
                Ok(crc) => crc,
                Err(_) => break,
            };

            let mut payload = vec![0u8; payload_len];
            if reader.read_exact(&mut payload).is_err() {
                break;
            }

            // Verify CRC32
            let actual_crc = crc32fast::hash(&payload);
            if actual_crc != expected_crc {
                tracing::warn!("CRC mismatch in cognitive log, skipping entry");
                continue;
            }

            let payload = self.codec.decode(&payload)?;
            match op {
                OP_STORE | OP_UPDATE => {
                    if let Ok(rec) = self.deserialize_record(&payload) {
                        records.insert(rec.id.clone(), rec);
                    }
                }
                OP_DELETE => {
                    if payload.len() >= 12 {
                        let id = String::from_utf8_lossy(&payload[..12])
                            .trim_matches('\0')
                            .to_string();
                        records.remove(&id);
                    }
                }
                OP_ATOMIC_UPSERTS => {
                    // Deserialize the complete frame before mutating replay
                    // state. A corrupt/partial batch can therefore never apply
                    // only one side of a version replacement.
                    match serde_json::from_slice::<Vec<Record>>(&payload) {
                        Ok(batch) => {
                            for rec in batch {
                                records.insert(rec.id.clone(), rec);
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "Invalid atomic cognitive batch, skipping frame");
                        }
                    }
                }
                OP_ATOMIC_RECORD_PATCHES => {
                    match serde_json::from_slice::<Vec<RecordPatch>>(&payload) {
                        Ok(batch)
                            if batch
                                .iter()
                                .all(|patch| records.contains_key(&patch.record_id)) =>
                        {
                            for patch in batch {
                                let record = records
                                    .get_mut(&patch.record_id)
                                    .expect("patch targets were prevalidated");
                                record.metadata.extend(patch.metadata_upserts);
                                for connection in patch.typed_connection_upserts {
                                    record.add_typed_connection(
                                        &connection.other_record_id,
                                        connection.weight,
                                        &connection.relationship,
                                    );
                                }
                            }
                        }
                        Ok(_) => {
                            tracing::warn!(
                                "Atomic cognitive patch referenced a missing record; skipping frame"
                            );
                        }
                        Err(error) => {
                            tracing::warn!(%error, "Invalid atomic cognitive patch, skipping frame");
                        }
                    }
                }
                OP_ATOMIC_MUTATIONS => {
                    match serde_json::from_slice::<CognitiveMutationBatch>(&payload) {
                        Ok(batch) => {
                            for id in batch.deletes {
                                records.remove(&id);
                            }
                            for rec in batch.upserts {
                                records.insert(rec.id.clone(), rec);
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "Invalid atomic cognitive mutation batch, skipping frame");
                        }
                    }
                }
                _ => {
                    tracing::warn!("Unknown op code {} in cognitive log", op);
                }
            }
        }

        Ok(())
    }

    /// Append a STORE entry for a new record.
    pub fn append_store(&self, rec: &Record) -> Result<()> {
        let payload = self.serialize_record(rec)?;
        self.append_entry(OP_STORE, &payload)
    }

    /// Append an UPDATE entry for an existing record.
    pub fn append_update(&self, rec: &Record) -> Result<()> {
        let payload = self.serialize_record(rec)?;
        self.append_entry(OP_UPDATE, &payload)
    }

    /// Append a DELETE tombstone.
    pub fn append_delete(&self, record_id: &str) -> Result<()> {
        let mut id_bytes = [0u8; 12];
        let src = record_id.as_bytes();
        let len = src.len().min(12);
        id_bytes[..len].copy_from_slice(&src[..len]);
        self.append_entry_internal(OP_DELETE, &id_bytes, true)
    }

    /// Atomically append several record upserts as one durable journal frame.
    ///
    /// The frame has one length and CRC. Replay first validates and deserializes
    /// the entire vector, then applies every record. A crash before the frame is
    /// complete leaves the previous journal state intact.
    pub fn append_atomic_upserts(&self, records: &[Record]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        #[cfg(test)]
        if self.fail_next_atomic_upsert.swap(false, Ordering::SeqCst) {
            anyhow::bail!("injected atomic cognitive upsert failure");
        }

        let payload = serde_json::to_vec(records)?;
        self.append_entry_internal(OP_ATOMIC_UPSERTS, &payload, true)
    }

    /// Atomically persist one lifecycle transition containing record updates and
    /// tombstones. The complete frame is validated before replay mutates state.
    pub(crate) fn append_atomic_mutations(
        &self,
        upserts: &[Record],
        deletes: &[String],
    ) -> Result<()> {
        if upserts.is_empty() && deletes.is_empty() {
            return Ok(());
        }
        #[cfg(test)]
        if self.fail_next_atomic_upsert.swap(false, Ordering::SeqCst) {
            anyhow::bail!("injected atomic cognitive mutation failure");
        }
        let batch = CognitiveMutationBatch {
            upserts: upserts.to_vec(),
            deletes: deletes.to_vec(),
        };
        let payload = serde_json::to_vec(&batch)?;
        self.append_entry_internal(OP_ATOMIC_MUTATIONS, &payload, true)
    }

    /// Atomically append compact metadata/connection changes.
    pub(crate) fn append_atomic_record_patches(&self, patches: &[RecordPatch]) -> Result<()> {
        if patches.is_empty() {
            return Ok(());
        }
        let payload = serde_json::to_vec(patches)?;
        self.append_entry_internal(OP_ATOMIC_RECORD_PATCHES, &payload, true)
    }

    #[cfg(test)]
    pub(crate) fn fail_next_atomic_upsert_for_test(&self) {
        self.fail_next_atomic_upsert.store(true, Ordering::SeqCst);
    }

    /// Low-level: append an entry to the log.
    fn append_entry(&self, op: u8, payload: &[u8]) -> Result<()> {
        self.append_entry_internal(op, payload, false)
    }

    fn append_entry_internal(&self, op: u8, payload: &[u8], durable: bool) -> Result<()> {
        let payload = self.codec.encode(payload)?;
        let crc = crc32fast::hash(&payload);

        let mut writer = self.writer.lock();
        let w = writer
            .as_mut()
            .ok_or_else(|| anyhow!("Cognitive store is closed"))?;
        w.write_u8(op)?;
        w.write_u32::<LittleEndian>(payload.len() as u32)?;
        w.write_u32::<LittleEndian>(crc)?;
        w.write_all(&payload)?;
        w.flush()?;
        if durable {
            w.get_ref().sync_all()?;
        }

        Ok(())
    }

    /// Write a snapshot of all current records.
    pub fn write_snapshot(&self, records: &HashMap<String, Record>) -> Result<()> {
        let log_pos = {
            let file = File::open(&self.log_path)?;
            file.metadata()?.len()
        };

        let temp_path = self.snap_path.with_extension("snap.tmp");
        {
            let file = File::create(&temp_path)?;
            let mut writer = BufWriter::new(file);
            writer.write_all(SNAP_MAGIC)?;
            writer.write_u8(if self.codec.is_encrypted() {
                3
            } else {
                VERSION
            })?;
            writer.write_u64::<LittleEndian>(log_pos)?;
            writer.write_u32::<LittleEndian>(records.len() as u32)?;

            for rec in records.values() {
                let payload = self.codec.encode(&self.serialize_record(rec)?)?;
                writer.write_u32::<LittleEndian>(payload.len() as u32)?;
                writer.write_all(&payload)?;
            }

            writer.flush()?;
            writer.get_ref().sync_all()?;
        }
        fs::rename(&temp_path, &self.snap_path)?;
        sync_parent_dir(&self.snap_path);
        Ok(())
    }

    /// Compact: rewrite log with only live records + write snapshot.
    pub fn compact(&self, records: &HashMap<String, Record>) -> Result<()> {
        let mut writer = self.writer.lock();
        self.compact_locked(&mut writer, records)
    }

    /// Reload the durable corpus and compact it, optionally dropping one record.
    ///
    /// The writer lock is held from reload to reopen, so records appended
    /// concurrently cannot be lost between reading the corpus and rewriting it.
    pub fn compact_durable(&self, exclude: Option<&str>) -> Result<HashMap<String, Record>> {
        let mut writer = self.writer.lock();
        if let Some(w) = writer.as_mut() {
            w.flush()?;
            w.get_ref().sync_all()?;
        }
        let (mut records, _) = self.load_from_disk()?;
        if let Some(id) = exclude {
            records.remove(id);
        }
        self.compact_locked(&mut writer, &records)?;
        Ok(records)
    }

    fn compact_locked(
        &self,
        writer: &mut Option<BufWriter<File>>,
        records: &HashMap<String, Record>,
    ) -> Result<()> {
        // Close writer
        *writer = None;

        // Rewrite log
        let temp_path = self.log_path.with_extension("tmp");
        {
            let mut f = File::create(&temp_path)?;
            f.write_all(MAGIC)?;
            f.write_u8(if self.codec.is_encrypted() {
                3
            } else {
                VERSION
            })?;

            for rec in records.values() {
                let payload = self.codec.encode(&self.serialize_record(rec)?)?;
                let crc = crc32fast::hash(&payload);
                f.write_u8(OP_STORE)?;
                f.write_u32::<LittleEndian>(payload.len() as u32)?;
                f.write_u32::<LittleEndian>(crc)?;
                f.write_all(&payload)?;
            }

            f.flush()?;
            f.sync_all()?;
        }

        // Drop the old snapshot before swapping logs. Its log offset refers to
        // the old log, so a crash after the swap must not pair it with the new
        // log. Without a snapshot, either log replays completely and correctly.
        if self.snap_path.exists() {
            fs::remove_file(&self.snap_path)?;
        }
        fs::rename(&temp_path, &self.log_path)?;
        sync_parent_dir(&self.log_path);

        // Write snapshot at end of new log
        self.write_snapshot(records)?;
        *self.log_position.lock() = fs::metadata(&self.log_path)?.len();

        // Reopen writer
        let file = OpenOptions::new().append(true).open(&self.log_path)?;
        *writer = Some(BufWriter::new(file));

        Ok(())
    }

    /// Flush pending writes.
    pub fn flush(&self) -> Result<()> {
        let mut writer = self.writer.lock();
        if let Some(w) = writer.as_mut() {
            w.flush()?;
            w.get_ref().sync_all()?;
        }
        Ok(())
    }

    // ── Serialization ──

    /// Flush pending writes and release the append handle.
    pub fn close(&self) -> Result<()> {
        self.flush()?;
        let mut writer = self.writer.lock();
        writer.take();
        Ok(())
    }

    fn serialize_record(&self, rec: &Record) -> Result<Vec<u8>> {
        let json = serde_json::to_vec(rec)?;
        Ok(json)
    }

    fn deserialize_record(&self, data: &[u8]) -> Result<Record> {
        let rec: Record = serde_json::from_slice(data)?;
        Ok(rec)
    }
}

/// Persist a rename by syncing the parent directory (POSIX only).
fn sync_parent_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::levels::Level;

    #[test]
    fn test_store_and_load() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        let mut rec = Record::new("Hello world".into(), Level::Working);
        rec.tags = vec!["test".into()];
        store.append_store(&rec)?;

        let records = store.load_all()?;
        assert_eq!(records.len(), 1);
        assert_eq!(records[&rec.id].content, "Hello world");
        Ok(())
    }

    #[test]
    fn test_update_and_delete() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        let mut rec = Record::new("original".into(), Level::Working);
        store.append_store(&rec)?;

        rec.content = "updated".into();
        store.append_update(&rec)?;

        let records = store.load_all()?;
        assert_eq!(records[&rec.id].content, "updated");

        store.append_delete(&rec.id)?;
        let records = store.load_all()?;
        assert!(records.is_empty());
        Ok(())
    }

    #[test]
    fn atomic_upsert_frame_replays_all_records_together() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        let mut old = Record::new("old policy".into(), Level::Domain);
        store.append_store(&old)?;
        let mut successor = Record::new("new policy".into(), Level::Domain);
        successor.caused_by_id = Some(old.id.clone());
        old.metadata
            .insert("superseded_by".into(), successor.id.clone());
        old.valid_until = Some(successor.created_at);

        store.append_atomic_upserts(&[old.clone(), successor.clone()])?;
        let loaded = store.load_all()?;
        assert_eq!(loaded.len(), 2);
        assert_eq!(
            loaded[&old.id].metadata.get("superseded_by"),
            Some(&successor.id)
        );
        assert_eq!(
            loaded[&successor.id].caused_by_id.as_deref(),
            Some(old.id.as_str())
        );
        Ok(())
    }

    #[test]
    fn atomic_mutation_frame_replays_updates_and_deletes_together() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        let mut retained = Record::new("retained memory".into(), Level::Working);
        let removed = Record::new("forgotten memory".into(), Level::Working);
        store.append_atomic_upserts(&[retained.clone(), removed.clone()])?;

        retained.strength = 0.8;
        store.append_atomic_mutations(&[retained.clone()], std::slice::from_ref(&removed.id))?;
        store.close()?;
        drop(store);

        let reopened = CognitiveStore::new(dir.path())?;
        let loaded = reopened.load_all()?;
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[&retained.id].strength, 0.8);
        assert!(!loaded.contains_key(&removed.id));
        Ok(())
    }

    #[test]
    fn truncated_atomic_mutation_tail_changes_nothing() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut retained = Record::new("original retained memory".into(), Level::Working);
        let removed = Record::new("original removable memory".into(), Level::Working);
        {
            let store = CognitiveStore::new(dir.path())?;
            store.append_atomic_upserts(&[retained.clone(), removed.clone()])?;
            store.close()?;
        }

        retained.strength = 0.8;
        let payload = serde_json::to_vec(&CognitiveMutationBatch {
            upserts: vec![retained.clone()],
            deletes: vec![removed.id.clone()],
        })?;
        let mut log = OpenOptions::new()
            .append(true)
            .open(dir.path().join("brain.cog"))?;
        log.write_u8(OP_ATOMIC_MUTATIONS)?;
        log.write_u32::<LittleEndian>(payload.len() as u32)?;
        log.write_u32::<LittleEndian>(crc32fast::hash(&payload))?;
        log.write_all(&payload[..payload.len() / 2])?;
        log.sync_all()?;
        drop(log);

        let reopened = CognitiveStore::new(dir.path())?;
        let loaded = reopened.load_all()?;
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[&retained.id].strength, 1.0);
        assert!(loaded.contains_key(&removed.id));
        Ok(())
    }

    #[test]
    fn compact_record_patches_replay_metadata_and_connections_atomically() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;
        let first = Record::new("first".into(), Level::Domain);
        let second = Record::new("second".into(), Level::Domain);
        store.append_store(&first)?;
        store.append_store(&second)?;

        let mut metadata_upserts = HashMap::new();
        metadata_upserts.insert("aura.audit.v1.entity_id".into(), "claim:first".into());
        store.append_atomic_record_patches(&[
            RecordPatch {
                record_id: first.id.clone(),
                metadata_upserts,
                typed_connection_upserts: vec![TypedConnectionPatch {
                    other_record_id: second.id.clone(),
                    weight: 1.0,
                    relationship: "supports".into(),
                }],
            },
            RecordPatch {
                record_id: second.id.clone(),
                metadata_upserts: HashMap::new(),
                typed_connection_upserts: vec![TypedConnectionPatch {
                    other_record_id: first.id.clone(),
                    weight: 1.0,
                    relationship: "supports".into(),
                }],
            },
        ])?;

        let loaded = store.load_all()?;
        assert_eq!(
            loaded[&first.id]
                .metadata
                .get("aura.audit.v1.entity_id")
                .map(String::as_str),
            Some("claim:first")
        );
        assert_eq!(
            loaded[&first.id].connection_type(&second.id),
            Some("supports")
        );
        assert_eq!(
            loaded[&second.id].connection_type(&first.id),
            Some("supports")
        );
        Ok(())
    }

    #[test]
    fn truncated_record_patch_tail_replays_none_of_the_batch() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let first = Record::new("patch source".into(), Level::Domain);
        let second = Record::new("patch target".into(), Level::Domain);
        {
            let store = CognitiveStore::new(dir.path())?;
            store.append_store(&first)?;
            store.append_store(&second)?;
            store.close()?;
        }

        let mut metadata_upserts = HashMap::new();
        metadata_upserts.insert("aura.audit.v1.entity_id".into(), "interrupted".into());
        let payload = serde_json::to_vec(&vec![RecordPatch {
            record_id: first.id.clone(),
            metadata_upserts,
            typed_connection_upserts: vec![TypedConnectionPatch {
                other_record_id: second.id.clone(),
                weight: 1.0,
                relationship: "supports".into(),
            }],
        }])?;
        let mut log = OpenOptions::new()
            .append(true)
            .open(dir.path().join("brain.cog"))?;
        log.write_u8(OP_ATOMIC_RECORD_PATCHES)?;
        log.write_u32::<LittleEndian>(payload.len() as u32)?;
        log.write_u32::<LittleEndian>(crc32fast::hash(&payload))?;
        log.write_all(&payload[..payload.len() / 2])?;
        log.sync_all()?;
        drop(log);

        let reopened = CognitiveStore::new(dir.path())?;
        let loaded = reopened.load_all()?;
        assert_eq!(
            loaded[&first.id].metadata.get("aura.audit.v1.entity_id"),
            None
        );
        assert_eq!(loaded[&first.id].connection_type(&second.id), None);
        Ok(())
    }

    #[test]
    fn truncated_atomic_upsert_tail_replays_none_of_the_batch() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let mut old = Record::new("old policy remains current".into(), Level::Domain);
        let old_id = old.id.clone();
        {
            let store = CognitiveStore::new(dir.path())?;
            store.append_store(&old)?;
            store.close()?;
        }

        let mut successor = Record::new("replacement was interrupted".into(), Level::Domain);
        successor.caused_by_id = Some(old.id.clone());
        old.metadata
            .insert("superseded_by".into(), successor.id.clone());
        old.valid_until = Some(successor.created_at);
        let payload = serde_json::to_vec(&vec![old, successor])?;
        let mut log = OpenOptions::new()
            .append(true)
            .open(dir.path().join("brain.cog"))?;
        log.write_u8(OP_ATOMIC_UPSERTS)?;
        log.write_u32::<LittleEndian>(payload.len() as u32)?;
        log.write_u32::<LittleEndian>(crc32fast::hash(&payload))?;
        log.write_all(&payload[..payload.len() / 2])?;
        log.sync_all()?;
        drop(log);

        let reopened = CognitiveStore::new(dir.path())?;
        let loaded = reopened.load_all()?;
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[&old_id].content, "old policy remains current");
        assert_eq!(loaded[&old_id].valid_until, None);
        assert_eq!(loaded[&old_id].metadata.get("superseded_by"), None);
        Ok(())
    }

    #[test]
    #[cfg(feature = "encryption")]
    fn encrypted_atomic_batches_snapshots_and_compaction_reopen() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let codec = crate::persistence::PersistenceCodec::new(Some(
            crate::crypto::EncryptionKey::generate(),
        ));
        let left = Record::new("PRIVATE_ENCRYPTED_BATCH_LEFT".into(), Level::Domain);
        let right = Record::new("PRIVATE_ENCRYPTED_BATCH_RIGHT".into(), Level::Domain);
        let store = CognitiveStore::with_codec(dir.path(), codec.clone())?;
        store.append_atomic_upserts(&[left.clone(), right.clone()])?;
        let records = store.load_all()?;
        assert_eq!(records.len(), 2);
        store.compact(&records)?;
        store.close()?;
        drop(store);
        for name in ["brain.cog", "brain.snap"] {
            let bytes = std::fs::read(dir.path().join(name))?;
            assert!(!bytes.windows(17).any(|w| w == b"PRIVATE_ENCRYPTED_"));
        }
        assert!(CognitiveStore::new(dir.path()).is_err());
        let reopened = CognitiveStore::with_codec(dir.path(), codec)?;
        let loaded = reopened.load_all()?;
        assert_eq!(loaded[&left.id].content, left.content);
        assert_eq!(loaded[&right.id].content, right.content);
        Ok(())
    }

    #[test]
    fn compact_durable_keeps_records_appended_after_caller_snapshot() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;
        let kept = Record::new("kept".into(), Level::Working);
        let purged = Record::new("purged".into(), Level::Working);
        store.append_store(&kept)?;
        store.append_store(&purged)?;
        store.write_snapshot(&store.load_all()?)?;
        let late = Record::new("appended later".into(), Level::Working);
        store.append_store(&late)?;

        store.compact_durable(Some(&purged.id))?;

        let reloaded = store.load_all()?;
        assert!(reloaded.contains_key(&kept.id));
        assert!(reloaded.contains_key(&late.id));
        assert!(!reloaded.contains_key(&purged.id));
        Ok(())
    }

    #[test]
    fn snapshot_past_end_of_log_falls_back_to_full_replay() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;
        let mut records = HashMap::new();
        for i in 0..5 {
            let rec = Record::new(format!("record {i}"), Level::Working);
            store.append_store(&rec)?;
            records.insert(rec.id.clone(), rec);
        }
        // Simulate a crash that left a snapshot from a longer, older log
        // generation next to a freshly compacted log.
        store.write_snapshot(&records)?;
        let stale_snapshot = std::fs::read(dir.path().join("brain.snap"))?;
        let survivor = records.values().next().unwrap().clone();
        let only = HashMap::from([(survivor.id.clone(), survivor.clone())]);
        store.compact(&only)?;
        let mut stale = stale_snapshot;
        stale[5..13].copy_from_slice(&u64::MAX.to_le_bytes());
        std::fs::write(dir.path().join("brain.snap"), stale)?;

        let reloaded = store.load_all()?;
        assert_eq!(reloaded.len(), 1);
        assert!(reloaded.contains_key(&survivor.id));
        Ok(())
    }

    #[test]
    fn test_snapshot_and_compact() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        for i in 0..10 {
            let rec = Record::new(format!("record {}", i), Level::Working);
            store.append_store(&rec)?;
        }

        let records = store.load_all()?;
        assert_eq!(records.len(), 10);

        store.compact(&records)?;

        let records2 = store.load_all()?;
        assert_eq!(records2.len(), 10);
        Ok(())
    }

    #[test]
    fn test_corrupted_snapshot_falls_back_to_log_replay() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store = CognitiveStore::new(dir.path())?;

        let rec = Record::new("snapshot fallback".into(), Level::Working);
        store.append_store(&rec)?;
        let records = store.load_all()?;
        store.write_snapshot(&records)?;

        std::fs::write(dir.path().join("brain.snap"), b"bad-snapshot")?;

        let recovered = store.load_all()?;
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[&rec.id].content, "snapshot fallback");
        Ok(())
    }

    #[test]
    fn test_close_releases_cognitive_store_handle() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let store_path = dir.path().join("close_test");
        std::fs::create_dir_all(&store_path)?;

        let store = CognitiveStore::new(&store_path)?;
        let rec = Record::new("close".into(), Level::Working);
        store.append_store(&rec)?;
        store.close()?;

        std::fs::remove_dir_all(&store_path)?;
        assert!(!store_path.exists());
        Ok(())
    }
}
