use anyhow::{anyhow, Result};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::instrument;
// use serde::{Serialize, Deserialize}; // Not needed if only using bincode functions

use crate::crypto::{decrypt_data, encrypt_data, EncryptionKey};
use crate::types::{AuraSynapse, Flux, Pulse};

const MAGIC_BYTES: &[u8; 4] = b"AURA";
const FORMAT_VERSION: u32 = 3;
const FILE_HEADER_SIZE: u64 = 64;

/// A memory record as stored on disk (V2/V3).
/// Matches Python's `RECORD_HEADER_FORMAT_V2 = '<32s 16s d f f f H I'`
#[derive(Debug, Clone)]
pub struct StoredRecord {
    pub id: String,          // 32 bytes fixed
    pub dna: String,         // 16 bytes fixed
    pub timestamp: f64,      // 8 bytes
    pub intensity: f32,      // 4 bytes
    pub stability: f32,      // 4 bytes (New in V3)
    pub decay_velocity: f32, // 4 bytes
    pub entropy: f32,        // 4 bytes
    pub sdr_indices: Vec<u16>,
    pub text: String,
    pub offset: u64,
}

impl StoredRecord {
    pub fn from_synapse(syn: &AuraSynapse) -> Self {
        Self {
            id: syn.id.clone(),
            dna: syn.flux.dna.clone(),
            timestamp: syn.pulse.last_resonance,
            intensity: syn.pulse.intensity,
            stability: syn.pulse.stability,
            decay_velocity: syn.pulse.decay_velocity,
            entropy: syn.flux.entropy,
            sdr_indices: syn.sdr_indices.clone(),
            text: syn.text.clone(),
            offset: 0,
        }
    }

    pub fn to_synapse(&self) -> AuraSynapse {
        AuraSynapse {
            id: self.id.clone(),
            text: self.text.clone(),
            sdr_indices: self.sdr_indices.clone(),
            pulse: Pulse {
                intensity: self.intensity,
                stability: self.stability,
                decay_velocity: self.decay_velocity,
                last_resonance: self.timestamp,
            },
            flux: Flux {
                entropy: self.entropy,
                parent_id: None, // Not stored in V2 binary yet
                dna: self.dna.clone(),
            },
        }
    }

    /// Write record to a writer in V2 binary format.
    pub fn write_to<W: Write>(&self, writer: &mut W) -> Result<()> {
        self.write_to_encrypted(writer, None)
    }

    /// Write record with optional encryption.
    /// If encryption_key is provided, text will be encrypted.
    pub fn write_to_encrypted<W: Write>(
        &self,
        writer: &mut W,
        encryption_key: Option<&EncryptionKey>,
    ) -> Result<()> {
        // 1. Prepare fixed-size strings
        let mut id_bytes = [0u8; 32];
        let id_raw = self.id.as_bytes();
        let len = std::cmp::min(id_raw.len(), 32);
        id_bytes[..len].copy_from_slice(&id_raw[..len]);

        let mut dna_bytes = [0u8; 16];
        let dna_raw = self.dna.as_bytes();
        let len = std::cmp::min(dna_raw.len(), 16);
        dna_bytes[..len].copy_from_slice(&dna_raw[..len]);

        // 2. Encrypt text if key provided
        let text_bytes: Vec<u8> = if let Some(key) = encryption_key {
            encrypt_data(self.text.as_bytes(), key)?
        } else {
            self.text.as_bytes().to_vec()
        };

        // Flag byte: 0x00 = plaintext, 0x01 = encrypted
        let encrypted_flag: u8 = if encryption_key.is_some() { 0x01 } else { 0x00 };

        // 3. Write Header (75 bytes with encryption flag)
        writer.write_all(&id_bytes)?;
        writer.write_all(&dna_bytes)?;
        writer.write_f64::<LittleEndian>(self.timestamp)?;
        writer.write_f32::<LittleEndian>(self.intensity)?;
        writer.write_f32::<LittleEndian>(self.stability)?;
        writer.write_f32::<LittleEndian>(self.decay_velocity)?;
        writer.write_f32::<LittleEndian>(self.entropy)?;
        writer.write_u16::<LittleEndian>(self.sdr_indices.len() as u16)?;
        writer.write_u32::<LittleEndian>(text_bytes.len() as u32)?;
        writer.write_u8(encrypted_flag)?;

        // 4. Write SDR Indices
        for &idx in &self.sdr_indices {
            writer.write_u16::<LittleEndian>(idx)?;
        }

        // 5. Write Text (possibly encrypted)
        writer.write_all(&text_bytes)?;

        Ok(())
    }

    /// Read record from a reader.
    pub fn read_from<R: Read>(reader: &mut R, offset: u64) -> Result<Self> {
        Self::read_from_encrypted(reader, offset, None)
    }

    /// Read record with optional decryption.
    pub fn read_from_encrypted<R: Read>(
        reader: &mut R,
        offset: u64,
        encryption_key: Option<&EncryptionKey>,
    ) -> Result<Self> {
        // 1. Read Header
        let mut id_bytes = [0u8; 32];
        if let Err(e) = reader.read_exact(&mut id_bytes) {
            return Err(anyhow!("Failed to read ID at offset {}: {}", offset, e));
        }
        let id = String::from_utf8_lossy(&id_bytes)
            .trim_matches('\0')
            .to_string();

        let mut dna_bytes = [0u8; 16];
        reader.read_exact(&mut dna_bytes)?;
        let dna = String::from_utf8_lossy(&dna_bytes)
            .trim_matches('\0')
            .to_string();

        let timestamp = reader.read_f64::<LittleEndian>()?;
        let intensity = reader.read_f32::<LittleEndian>()?;
        let stability = reader.read_f32::<LittleEndian>()?;
        let decay_velocity = reader.read_f32::<LittleEndian>()?;
        let entropy = reader.read_f32::<LittleEndian>()?;
        let sdr_count = reader.read_u16::<LittleEndian>()?;
        let text_len = reader.read_u32::<LittleEndian>()?;

        // Read encryption flag (new field, defaults to 0 for old files)
        let encrypted_flag = reader.read_u8().unwrap_or(0);

        // 2. Read SDR Indices
        let mut sdr_indices = Vec::with_capacity(sdr_count as usize);
        for i in 0..sdr_count {
            match reader.read_u16::<LittleEndian>() {
                Ok(idx) => sdr_indices.push(idx),
                Err(e) => {
                    return Err(anyhow!(
                        "Failed to read SDR bit {} at offset {}: {}",
                        i,
                        offset,
                        e
                    ))
                }
            }
        }

        // 3. Read Text (possibly encrypted)
        let mut text_bytes = vec![0u8; text_len as usize];
        if let Err(e) = reader.read_exact(&mut text_bytes) {
            return Err(anyhow!(
                "Failed to read text of len {} at offset {}: {}",
                text_len,
                offset,
                e
            ));
        }

        // 4. Decrypt if needed
        let text = if encrypted_flag == 0x01 {
            // Text is encrypted
            if let Some(key) = encryption_key {
                let decrypted = decrypt_data(&text_bytes, key)
                    .map_err(|e| anyhow!("Decryption failed for record {}: {}", id, e))?;
                String::from_utf8(decrypted).unwrap_or_else(|_| "<decryption error>".to_string())
            } else {
                "<encrypted - no key>".to_string()
            }
        } else {
            // Text is plaintext
            String::from_utf8(text_bytes).unwrap_or_else(|_| "<invalid utf8>".to_string())
        };

        Ok(Self {
            id,
            dna,
            timestamp,
            intensity,
            stability,
            decay_velocity,
            entropy,
            sdr_indices,
            text,
            offset,
        })
    }
}

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug)]
pub struct StoredHeader {
    pub id: String,
    pub dna: String,
    pub timestamp: AtomicU64,
    pub intensity: AtomicU32,
    pub stability: AtomicU32,
    pub decay_velocity: AtomicU32,
    pub entropy: AtomicU32,
    pub sdr_indices: Vec<u16>,
    pub text: String,
    /// Temporal chain: pointer to the chronologically next record (RAM-only).
    /// Set by ingest_batch() for sequence prediction. O(1) lookup.
    pub next_id: RwLock<Option<String>>,
}

impl StoredHeader {
    pub fn intensity(&self) -> f32 {
        f32::from_bits(self.intensity.load(Ordering::Relaxed))
    }

    pub fn set_intensity(&self, val: f32) {
        self.intensity.store(val.to_bits(), Ordering::Relaxed);
    }

    pub fn stability(&self) -> f32 {
        f32::from_bits(self.stability.load(Ordering::Relaxed))
    }

    pub fn set_stability(&self, val: f32) {
        self.stability.store(val.to_bits(), Ordering::Relaxed);
    }

    pub fn timestamp(&self) -> f64 {
        f64::from_bits(self.timestamp.load(Ordering::Relaxed))
    }

    pub fn set_timestamp(&self, val: f64) {
        self.timestamp.store(val.to_bits(), Ordering::Relaxed);
    }

    pub fn decay_velocity(&self) -> f32 {
        f32::from_bits(self.decay_velocity.load(Ordering::Relaxed))
    }

    pub fn set_decay_velocity(&self, val: f32) {
        self.decay_velocity.store(val.to_bits(), Ordering::Relaxed);
    }

    pub fn entropy(&self) -> f32 {
        f32::from_bits(self.entropy.load(Ordering::Relaxed))
    }

    pub fn set_entropy(&self, val: f32) {
        self.entropy.store(val.to_bits(), Ordering::Relaxed);
    }
}

impl StoredHeader {
    pub fn from_record(record: &StoredRecord) -> Arc<Self> {
        Arc::new(Self {
            id: record.id.clone(),
            dna: record.dna.clone(),
            timestamp: AtomicU64::new(record.timestamp.to_bits()),
            intensity: AtomicU32::new(record.intensity.to_bits()),
            stability: AtomicU32::new(record.stability.to_bits()),
            decay_velocity: AtomicU32::new(record.decay_velocity.to_bits()),
            entropy: AtomicU32::new(record.entropy.to_bits()),
            sdr_indices: record.sdr_indices.clone(),
            text: record.text.clone(),
            next_id: RwLock::new(None),
        })
    }
}

pub struct AuraStorage {
    _path: PathBuf,
    file_path: PathBuf,
    offsets: RwLock<HashMap<String, u64>>,
    record_count: RwLock<u64>,
    writer: Mutex<Option<BufWriter<File>>>,
    dirty_header: Mutex<bool>,
    needs_flush: Mutex<bool>,
    anchor_ids: RwLock<std::collections::HashSet<String>>,
    reader: Mutex<Option<File>>,
    // RAM Cache for high-speed retrieval (SDR + Metadata)
    pub header_cache: RwLock<HashMap<String, Arc<StoredHeader>>>,
    // Optional encryption key for data-at-rest encryption
    encryption_key: Option<EncryptionKey>,
    // Path to temporal link storage
    temporal_path: PathBuf,
    // Exclusive OS lock on `brain.lock`; held for the lifetime of the storage so
    // two processes cannot append to and compact the same brain concurrently.
    dir_lock: Mutex<Option<File>>,
}

impl AuraStorage {
    /// Get the storage directory path.
    pub fn path(&self) -> &Path {
        &self._path
    }

    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        Self::with_encryption(path, None)
    }

    /// Create storage with optional encryption key.
    pub fn with_encryption<P: AsRef<Path>>(
        path: P,
        encryption_key: Option<EncryptionKey>,
    ) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        std::fs::create_dir_all(&path)?;
        let dir_lock = Self::lock_directory(&path)?;
        let file_path = path.join("brain.aura");
        let temporal_path = path.join("temporal.bin");

        let exists = file_path.exists();

        // Initialize file if needed
        if !exists {
            Self::write_initial_header(&file_path)?;
        }

        // Open persistent writer in Read/Write mode to allow seeking
        let reader_file = File::open(&file_path)?;
        let writer_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&file_path)?;

        let writer = Mutex::new(Some(BufWriter::new(writer_file)));

        let storage = Self {
            _path: path,
            file_path,
            offsets: RwLock::new(HashMap::new()),
            record_count: RwLock::new(0),
            writer,
            dirty_header: Mutex::new(false),
            needs_flush: Mutex::new(false),
            anchor_ids: RwLock::new(std::collections::HashSet::new()),
            reader: Mutex::new(Some(reader_file)),
            header_cache: RwLock::new(HashMap::new()),
            encryption_key,
            temporal_path,
            dir_lock: Mutex::new(Some(dir_lock)),
        };

        if exists {
            storage.read_header()?;
            storage.rebuild_index()?;
            // Load persistent temporal chains from disk
            if let Err(e) = storage.load_temporal_chain() {
                // If this fails (e.g. first run after upgrade, or corruption),
                // we log it but don't crash. The chains just start empty.
                tracing::warn!(
                    "Failed to load temporal chains: {}. System assumes clean start.",
                    e
                );
            }
        }

        if storage.encryption_key.is_some() {
            tracing::info!("🔐 Storage encryption ENABLED");
        }

        Ok(storage)
    }

    fn lock_directory(path: &Path) -> Result<File> {
        use fs2::FileExt;
        let lock_path = path.join("brain.lock");
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&lock_path)?;
        file.try_lock_exclusive().map_err(|error| {
            anyhow!(
                "Aura brain at {} is already open in another process or handle ({}).                  Close it first or use a separate directory.",
                path.display(),
                error
            )
        })?;
        Ok(file)
    }

    /// Check if encryption is enabled
    pub fn is_encrypted(&self) -> bool {
        self.encryption_key.is_some()
    }

    fn write_initial_header(path: &Path) -> Result<()> {
        let file = File::create(path)?;
        let mut writer = BufWriter::new(file);

        // Magic (4) + Version (4) + Count (8) + Created (8) + Padding (40) = 64
        writer.write_all(MAGIC_BYTES)?;
        writer.write_u32::<LittleEndian>(FORMAT_VERSION)?;
        writer.write_u64::<LittleEndian>(0)?; // Initial count

        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs_f64();
        writer.write_f64::<LittleEndian>(now)?;

        writer.write_all(&[0u8; 40])?; // Padding
        writer.flush()?;

        Ok(())
    }

    fn read_header(&self) -> Result<()> {
        let mut file = File::open(&self.file_path)?;
        let mut magic = [0u8; 4];
        file.read_exact(&mut magic)?;

        if &magic != MAGIC_BYTES {
            return Err(anyhow!("Invalid magic bytes"));
        }

        let version = file.read_u32::<LittleEndian>()?;
        if version > FORMAT_VERSION {
            return Err(anyhow!("Unsupported version: {}", version));
        }

        let count = file.read_u64::<LittleEndian>()?;
        *self.record_count.write() = count;

        Ok(())
    }

    fn rebuild_index(&self) -> Result<()> {
        let mut file = BufReader::new(File::open(&self.file_path)?);
        file.seek(SeekFrom::Start(FILE_HEADER_SIZE))?;

        let mut offsets = self.offsets.write();
        let mut anchors = self.anchor_ids.write();
        let mut header_cache = self.header_cache.write();

        offsets.clear();
        anchors.clear();
        header_cache.clear();

        let mut count = 0;
        let len = file.get_ref().metadata()?.len();
        let enc_key = self.encryption_key.as_ref();
        let mut torn_at: Option<u64> = None;

        while file.stream_position()? < len {
            let offset = file.stream_position()?;

            // A record that cannot be read completely is a torn tail left by a
            // crash mid-append. Stop there instead of refusing to open.
            let entry = match read_index_entry(&mut file, len) {
                Ok(entry) => entry,
                Err(error) => {
                    tracing::warn!(offset, %error, "Truncating torn record at end of brain.aura");
                    torn_at = Some(offset);
                    break;
                }
            };
            let IndexEntry {
                id,
                dna,
                timestamp,
                intensity,
                stability,
                decay_velocity,
                entropy,
                sdr_indices,
                encrypted,
                text_bytes,
            } = entry;

            if dna == "user_core" {
                anchors.insert(id.clone());
            }

            // Decrypt if needed
            let text = if encrypted {
                if let Some(key) = enc_key {
                    match decrypt_data(&text_bytes, key) {
                        Ok(decrypted) => String::from_utf8(decrypted).unwrap_or_default(),
                        Err(_) => "<decryption failed>".to_string(),
                    }
                } else {
                    "<encrypted>".to_string()
                }
            } else {
                String::from_utf8(text_bytes).unwrap_or_default()
            };

            // Populate Cache
            header_cache.insert(
                id.clone(),
                Arc::new(StoredHeader {
                    id: id.clone(),
                    dna: dna.clone(),
                    timestamp: AtomicU64::new(timestamp.to_bits()),
                    intensity: AtomicU32::new(intensity.to_bits()),
                    stability: AtomicU32::new(stability.to_bits()),
                    decay_velocity: AtomicU32::new(decay_velocity.to_bits()),
                    entropy: AtomicU32::new(entropy.to_bits()),
                    sdr_indices,
                    text,
                    next_id: RwLock::new(None),
                }),
            );

            // Store offset
            offsets.insert(id, offset);
            count += 1;
        }

        // Cut the torn bytes so later appends are not written after garbage.
        if let Some(offset) = torn_at {
            let file = OpenOptions::new().write(true).open(&self.file_path)?;
            file.set_len(offset)?;
            file.sync_all()?;
            *self.dirty_header.lock() = true;
        }

        *self.record_count.write() = count;
        Ok(())
    }

    #[instrument(skip(self, record))]
    pub fn append(&self, record: &StoredRecord) -> Result<u64> {
        let mut writer = self.writer.lock();
        let writer = writer
            .as_mut()
            .ok_or_else(|| anyhow!("Storage is closed"))?;

        // Seek to end to append
        let offset = writer.seek(SeekFrom::End(0))?;

        // Write with encryption if key is present
        if let Err(e) = record.write_to_encrypted(&mut *writer, self.encryption_key.as_ref()) {
            tracing::error!("Failed to write record {}: {}", record.id, e);
            return Err(e);
        }
        // NOTE: We don't flush record here for bulk performance.
        // flush() or periodic BufWriter eviction will handle it.

        // Update in-memory index
        self.offsets.write().insert(record.id.clone(), offset);
        self.header_cache
            .write()
            .insert(record.id.clone(), StoredHeader::from_record(record));
        if record.dna == "user_core" {
            self.anchor_ids.write().insert(record.id.clone());
        }

        // Update count in memory
        *self.record_count.write() += 1;
        *self.dirty_header.lock() = true;
        *self.needs_flush.lock() = true;

        tracing::debug!(
            "Appended record {} at offset {} (encrypted: {})",
            record.id,
            offset,
            self.is_encrypted()
        );

        Ok(offset)
    }

    /// Append multiple records in a single lock acquisition.
    /// Returns the number of records written successfully.
    /// This is 100x faster than calling append() for each record.
    #[instrument(skip(self, records), fields(batch_size = records.len()))]
    pub fn append_batch(&self, records: &[StoredRecord]) -> Result<usize> {
        if records.is_empty() {
            return Ok(0);
        }

        // Single lock acquisition for writer
        let mut writer = self.writer.lock();
        let writer = writer
            .as_mut()
            .ok_or_else(|| anyhow!("Storage is closed"))?;

        // Single lock acquisition for offsets and anchors
        let mut offsets = self.offsets.write();
        let mut anchors = self.anchor_ids.write();
        let mut header_cache = self.header_cache.write();

        let mut written = 0;
        let enc_key = self.encryption_key.as_ref();

        for record in records {
            // Seek to end to append
            let offset = writer.seek(SeekFrom::End(0))?;

            // Write with encryption if key is present
            if let Err(e) = record.write_to_encrypted(&mut *writer, enc_key) {
                tracing::error!("Failed to write record {}: {}", record.id, e);
                continue; // Skip failed records but continue batch
            }

            // Update in-memory index
            offsets.insert(record.id.clone(), offset);
            header_cache.insert(record.id.clone(), StoredHeader::from_record(record));
            if record.dna == "user_core" {
                anchors.insert(record.id.clone());
            }

            written += 1;
        }

        // Update count in a single operation
        *self.record_count.write() += written as u64;
        *self.dirty_header.lock() = true;
        *self.needs_flush.lock() = true;

        // Flush after batch to ensure data reaches disk
        writer.flush()?;
        writer.get_ref().sync_all()?;
        *self.needs_flush.lock() = false;

        tracing::debug!(
            "Appended {} records in batch (encrypted: {})",
            written,
            self.is_encrypted()
        );

        Ok(written)
    }

    #[instrument(skip(self))]
    pub fn flush(&self) -> Result<()> {
        let mut writer = self.writer.lock();
        let writer = match writer.as_mut() {
            Some(w) => w,
            None => return Ok(()), // already closed
        };
        writer.flush()?;
        *self.needs_flush.lock() = false;

        let mut dirty = self.dirty_header.lock();
        if *dirty {
            let count = *self.record_count.read();
            writer.seek(SeekFrom::Start(8))?;
            writer.write_u64::<LittleEndian>(count)?;
            writer.flush()?;

            // Seeking back to end ensures next append is safe
            writer.seek(SeekFrom::End(0))?;
            *dirty = false;
        }

        // fsync: force OS to write buffers to physical disk.
        // Without this, data can be lost on crash/power failure.
        writer.get_ref().sync_all()?;

        // Also persist temporal graph (propagate error)
        self.save_temporal_chain()?;

        Ok(())
    }

    pub fn read(&self, id: &str) -> Result<Option<StoredRecord>> {
        let offset = {
            let offsets = self.offsets.read();
            match offsets.get(id) {
                Some(&o) => o,
                None => return Ok(None),
            }
        };

        // Ensure any pending writes are flushed before reading from a fresh handle.
        // Lock order is writer -> needs_flush everywhere (see append/flush).
        let pending = *self.needs_flush.lock();
        if pending {
            let mut writer = self.writer.lock();
            let writer = writer
                .as_mut()
                .ok_or_else(|| anyhow!("Storage is closed"))?;
            writer.flush()?;
            *self.needs_flush.lock() = false;
        }

        // For reading, we use a persistent handle to avoid exhaustion
        let mut file = self.reader.lock();
        let file = file.as_mut().ok_or_else(|| anyhow!("Storage is closed"))?;
        file.seek(SeekFrom::Start(offset))?;
        let mut reader = BufReader::new(&mut *file);

        // Read with decryption if encryption key is available
        let record =
            StoredRecord::read_from_encrypted(&mut reader, offset, self.encryption_key.as_ref())?;
        Ok(Some(record))
    }

    /// Get header from RAM cache for high-speed retrieval.
    pub fn get_header(&self, id: &str) -> Option<Arc<StoredHeader>> {
        self.header_cache.read().get(id).cloned()
    }

    /// Update header in RAM cache.
    pub fn update_header(&self, header: Arc<StoredHeader>) {
        self.header_cache.write().insert(header.id.clone(), header);
    }

    /// Count phantom records in the header cache (SDR Exchange imports).
    pub fn phantom_count(&self) -> usize {
        self.header_cache
            .read()
            .values()
            .filter(|h| h.dna == "phantom")
            .count()
    }

    /// Iterate over all active records.
    pub fn iter_all(&self) -> Result<Vec<StoredRecord>> {
        // Snapshot the ids first: read() may take the writer lock, and append()
        // takes offsets while holding the writer.
        let ids: Vec<String> = self.offsets.read().keys().cloned().collect();
        let mut records = Vec::with_capacity(ids.len());

        for id in &ids {
            if let Some(record) = self.read(id)? {
                records.push(record);
            }
        }

        Ok(records)
    }

    /// Get all anchor records (DNA: user_core).
    pub fn get_anchors(&self) -> Result<Vec<StoredRecord>> {
        let all = self.iter_all()?;
        Ok(all.into_iter().filter(|r| r.dna == "user_core").collect())
    }

    /// Get all super-core records (DNA: super_core).
    pub fn get_super_cores(&self) -> Result<Vec<StoredRecord>> {
        let all = self.iter_all()?;
        Ok(all.into_iter().filter(|r| r.dna == "super_core").collect())
    }

    /// Soft-delete a record by removing it from the offset index.
    /// The data remains on disk until `compact_active` rewrites the container.
    pub fn delete(&self, id: &str) -> bool {
        let mut offsets = self.offsets.write();
        let mut anchors = self.anchor_ids.write();
        if offsets.remove(id).is_some() {
            anchors.remove(id);
            let mut headers = self.header_cache.write();
            headers.remove(id);
            for header in headers.values() {
                let mut next = header.next_id.write();
                if next.as_deref() == Some(id) {
                    *next = None;
                }
            }
            let mut count = self.record_count.write();
            if *count > 0 {
                *count -= 1;
            }
            *self.dirty_header.lock() = true;
            tracing::debug!("Soft-deleted record: {}", id);
            true
        } else {
            false
        }
    }

    /// Rewrite the binary container with active records only.
    ///
    /// The writer lock is held for the whole operation so concurrent appends
    /// cannot be lost. The replacement is staged and synced, then atomically
    /// renamed over the live file, so a crash leaves either the old or the new
    /// container in place. A hard-linked backup allows rollback if the new
    /// container cannot be indexed.
    pub fn compact_active(&self) -> Result<usize> {
        self.flush()?;
        let mut writer_slot = self.writer.lock();
        if let Some(writer) = writer_slot.as_mut() {
            writer.flush()?;
            writer.get_ref().sync_all()?;
        }
        *self.needs_flush.lock() = false;

        let records = self.iter_all()?;
        let links = self.temporal_links();
        let temporary = self
            .file_path
            .with_extension(format!("aura.{}.purge.tmp", uuid::Uuid::new_v4()));
        let backup = self
            .file_path
            .with_extension(format!("aura.{}.purge.bak", uuid::Uuid::new_v4()));

        let write_result = (|| -> Result<()> {
            Self::write_initial_header(&temporary)?;
            let file = OpenOptions::new().read(true).write(true).open(&temporary)?;
            let mut writer = BufWriter::new(file);
            writer.seek(SeekFrom::End(0))?;
            for record in &records {
                record.write_to_encrypted(&mut writer, self.encryption_key.as_ref())?;
            }
            writer.seek(SeekFrom::Start(8))?;
            writer.write_u64::<LittleEndian>(records.len() as u64)?;
            writer.flush()?;
            writer.get_ref().sync_all()?;
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }

        self.reader.lock().take();
        writer_slot.take();

        let swap_result = (|| -> Result<()> {
            if std::fs::hard_link(&self.file_path, &backup).is_err() {
                std::fs::copy(&self.file_path, &backup)?;
            }
            // `rename` replaces the destination atomically on both POSIX and
            // Windows (MoveFileExW with MOVEFILE_REPLACE_EXISTING).
            std::fs::rename(&temporary, &self.file_path)?;
            sync_parent_dir(&self.file_path);
            Ok(())
        })();

        if let Err(error) = swap_result {
            let _ = std::fs::remove_file(&temporary);
            let _ = std::fs::remove_file(&backup);
            self.reopen_handles_into(&mut writer_slot)?;
            return Err(error);
        }

        let reopen = self
            .reopen_handles_into(&mut writer_slot)
            .and_then(|_| self.rebuild_index());
        if let Err(error) = reopen {
            self.reader.lock().take();
            writer_slot.take();
            std::fs::rename(&backup, &self.file_path)?;
            self.reopen_handles_into(&mut writer_slot)?;
            self.rebuild_index()?;
            self.restore_temporal_links(&links);
            return Err(error);
        }

        let _ = std::fs::remove_file(&backup);
        *self.dirty_header.lock() = false;
        *self.needs_flush.lock() = false;
        drop(writer_slot);
        self.restore_temporal_links(&links);
        self.save_temporal_chain()?;
        Ok(records.len())
    }

    fn reopen_handles_into(&self, writer_slot: &mut Option<BufWriter<File>>) -> Result<()> {
        let reader = File::open(&self.file_path)?;
        let writer = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.file_path)?;
        *self.reader.lock() = Some(reader);
        *writer_slot = Some(BufWriter::new(writer));
        Ok(())
    }

    /// Snapshot the RAM-only temporal chain (`next_id` links).
    fn temporal_links(&self) -> HashMap<String, String> {
        self.header_cache
            .read()
            .iter()
            .filter_map(|(id, header)| {
                header
                    .next_id
                    .read()
                    .as_ref()
                    .map(|next| (id.clone(), next.clone()))
            })
            .collect()
    }

    /// Reapply temporal links whose endpoints are still present.
    fn restore_temporal_links(&self, links: &HashMap<String, String>) {
        let headers = self.header_cache.read();
        for (from, to) in links {
            if headers.contains_key(to) {
                if let Some(header) = headers.get(from) {
                    *header.next_id.write() = Some(to.clone());
                }
            }
        }
    }

    /// Get the number of active records.
    pub fn count(&self) -> u64 {
        *self.record_count.read()
    }

    /// Get all active record IDs.
    pub fn get_all_ids(&self) -> Vec<String> {
        self.offsets.read().keys().cloned().collect()
    }

    /// Get anchor IDs for O(k) lookup.
    ///
    /// Returns list of IDs where DNA is "user_core".
    /// Used for efficient goal resonance calculation via inverted index.
    pub fn get_anchor_ids(&self) -> Vec<String> {
        self.anchor_ids.read().iter().cloned().collect()
    }

    pub fn has_anchor(&self, id: &str) -> bool {
        self.anchor_ids.read().contains(id)
    }

    /// Set temporal chain link: record `from_id` points to `to_id` as its successor.
    /// Used by ingest_batch() to build sequence prediction chains in RAM.
    pub fn set_next_id(&self, from_id: &str, to_id: &str) {
        if let Some(header) = self.header_cache.read().get(from_id) {
            *header.next_id.write() = Some(to_id.to_string());
        }
    }

    /// Get the next record in the temporal chain (O(1) RAM lookup).
    /// Returns None if no chain link exists or the target record is missing.
    pub fn get_prediction(&self, id: &str) -> Option<Arc<StoredHeader>> {
        let cache = self.header_cache.read();
        let header = cache.get(id)?;
        let next = header.next_id.read();
        let next_id = next.as_ref()?;
        cache.get(next_id).cloned()
    }

    pub fn anchor_count(&self) -> usize {
        self.anchor_ids.read().len()
    }

    /// Save the RAM-only temporal chains (next_id links) to `temporal.bin`
    pub fn save_temporal_chain(&self) -> Result<()> {
        let headers = self.header_cache.read();

        // Collect only active links to save space
        let mut links: HashMap<String, String> = HashMap::with_capacity(headers.len() / 2);
        for (id, header) in headers.iter() {
            if let Some(next) = header.next_id.read().as_ref() {
                links.insert(id.clone(), next.clone());
            }
        }

        // Serialize to temporary file then rename (atomic)
        let temp_path = self.temporal_path.with_extension("tmp");
        let file = File::create(&temp_path)?;
        let mut writer = BufWriter::new(file);

        // Header: Magic "TPL1" + Version (u8)
        writer.write_all(b"TPL1")?;
        writer.write_u8(1)?;

        bincode::serialize_into(&mut writer, &links)?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        std::fs::rename(temp_path, &self.temporal_path)?;

        tracing::debug!(
            "Saved {} temporal links to {:?}",
            links.len(),
            self.temporal_path
        );
        Ok(())
    }

    /// Load temporal chains from `temporal.bin` and populate `next_id` in headers
    pub fn load_temporal_chain(&self) -> Result<()> {
        if !self.temporal_path.exists() {
            return Ok(());
        }

        let file = File::open(&self.temporal_path)?;
        let mut reader = BufReader::new(file);

        // Verify Header
        let mut magic = [0u8; 4];
        if reader.read_exact(&mut magic).is_err() {
            // Empty file or too short?
            return Ok(());
        }

        if &magic != b"TPL1" {
            // Fallback for v0 (no header)? Or just error?
            // Since this is v1.7 and we just introduced it, we can enforce it.
            // But if user ran code from 5 mins ago, they have a no-header file.
            // Let's be strict: if magic fails, we assume corruption or old version and skip.
            // Actually, bincode deserialization would fail on "TPL1" anyway.
            tracing::warn!("Invalid magic bytes in temporal.bin. Skipping load.");
            return Ok(());
        }

        let version = reader.read_u8()?;
        if version != 1 {
            tracing::warn!("Unsupported temporal.bin version: {}. Skipping.", version);
            return Ok(());
        }

        let links: HashMap<String, String> = bincode::deserialize_from(reader)?;
        let headers = self.header_cache.read();

        let mut applied = 0;
        for (from, to) in links {
            if let Some(header) = headers.get(&from) {
                *header.next_id.write() = Some(to);
                applied += 1;
            }
        }

        tracing::info!(
            "Loaded {} temporal links from {:?}",
            applied,
            self.temporal_path
        );
        Ok(())
    }

    /// Flush all pending writes and release open file handles.
    pub fn close(&self) -> Result<()> {
        self.flush()?;

        let mut reader = self.reader.lock();
        reader.take();

        let mut writer = self.writer.lock();
        writer.take();

        // Dropping the handle releases the OS lock so the brain can be reopened.
        self.dir_lock.lock().take();

        Ok(())
    }
}

impl Drop for AuraStorage {
    fn drop(&mut self) {
        if let Err(e) = self.close() {
            // os error 3 (path not found) is expected when a tempdir is dropped
            // before the Aura instance — suppress it to avoid test noise.
            let is_path_gone = e
                .downcast_ref::<std::io::Error>()
                .and_then(|io| io.raw_os_error())
                .map(|code| code == 3)
                .unwrap_or(false);
            if !is_path_gone {
                eprintln!("AuraStorage: failed to close on drop: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_temporal_persistence() -> Result<()> {
        let dir = tempdir()?;
        let storage = AuraStorage::new(dir.path())?;

        // 1. Create Headers in RAM (simulated ingest)
        {
            let mut headers = storage.header_cache.write();
            headers.insert(
                "A".to_string(),
                StoredHeader::from_record(&mock_record("A")),
            );
            headers.insert(
                "B".to_string(),
                StoredHeader::from_record(&mock_record("B")),
            );

            // Link A -> B
            *headers.get("A").unwrap().next_id.write() = Some("B".to_string());
        }

        // 2. Save
        storage.save_temporal_chain()?;

        // Verify file exists and has magic bytes
        let path = dir.path().join("temporal.bin");
        assert!(path.exists());
        let content = std::fs::read(&path)?;
        assert_eq!(&content[0..4], b"TPL1"); // Magic
        assert_eq!(content[4], 1); // Version

        // 3. Load into FRESH storage
        drop(storage);
        let storage2 = AuraStorage::new(dir.path())?;
        // Need to simulate "rebuild_index" or manually populate headers for load to work
        {
            let mut headers = storage2.header_cache.write();
            headers.insert(
                "A".to_string(),
                StoredHeader::from_record(&mock_record("A")),
            );
            headers.insert(
                "B".to_string(),
                StoredHeader::from_record(&mock_record("B")),
            );
        }

        storage2.load_temporal_chain()?;

        // 4. Verify Link
        let headers = storage2.header_cache.read();
        let next_a = headers.get("A").unwrap().next_id.read();
        assert_eq!(next_a.as_deref(), Some("B"));

        Ok(())
    }

    #[test]
    fn test_close_releases_storage_handles() -> Result<()> {
        let dir = tempdir()?;
        let storage_path = dir.path().join("close_test");
        std::fs::create_dir_all(&storage_path)?;

        let storage = AuraStorage::new(&storage_path)?;
        storage.append(&mock_record("close"))?;
        storage.close()?;

        std::fs::remove_dir_all(&storage_path)?;
        assert!(!storage_path.exists());
        Ok(())
    }

    fn mock_record(id: &str) -> StoredRecord {
        StoredRecord {
            id: id.to_string(),
            dna: "DNA".to_string(),
            timestamp: 0.0,
            intensity: 0.0,
            stability: 0.0,
            decay_velocity: 0.0,
            entropy: 0.0,
            sdr_indices: vec![],
            text: "text".to_string(),
            offset: 0,
        }
    }

    #[test]
    fn second_open_of_same_directory_is_rejected_until_close() -> Result<()> {
        let dir = tempdir()?;
        let storage = AuraStorage::new(dir.path())?;
        assert!(AuraStorage::new(dir.path()).is_err());
        storage.close()?;
        let reopened = AuraStorage::new(dir.path())?;
        drop(reopened);
        Ok(())
    }

    #[test]
    fn torn_tail_is_truncated_and_later_appends_survive_reopen() -> Result<()> {
        let dir = tempdir()?;
        {
            let storage = AuraStorage::new(dir.path())?;
            storage.append(&mock_record("A"))?;
            storage.append(&mock_record("B"))?;
            storage.close()?;
        }
        // Simulate a crash mid-append: chop the last record in half.
        let path = dir.path().join("brain.aura");
        let len = std::fs::metadata(&path)?.len();
        let file = OpenOptions::new().write(true).open(&path)?;
        file.set_len(len - 10)?;
        drop(file);

        {
            let storage = AuraStorage::new(dir.path())?;
            assert!(storage.read("A")?.is_some());
            assert!(storage.read("B")?.is_none());
            storage.append(&mock_record("C"))?;
            storage.close()?;
        }

        let storage = AuraStorage::new(dir.path())?;
        assert!(storage.read("A")?.is_some());
        assert!(storage.read("C")?.is_some());
        Ok(())
    }

    #[test]
    fn compact_active_preserves_records_and_temporal_links() -> Result<()> {
        let dir = tempdir()?;
        let storage = AuraStorage::new(dir.path())?;
        for id in ["A", "B", "C"] {
            storage.append(&mock_record(id))?;
        }
        storage.set_next_id("A", "B");
        storage.set_next_id("B", "C");
        storage.delete("C");

        assert_eq!(storage.compact_active()?, 2);
        assert!(storage.read("A")?.is_some());
        assert!(storage.read("C")?.is_none());
        assert_eq!(
            storage.get_prediction("A").map(|h| h.id.clone()),
            Some("B".into())
        );
        storage.close()?;

        let reopened = AuraStorage::new(dir.path())?;
        assert_eq!(
            reopened.get_prediction("A").map(|h| h.id.clone()),
            Some("B".into())
        );
        let leftovers = std::fs::read_dir(dir.path())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".purge."))
            .count();
        assert_eq!(leftovers, 0);
        Ok(())
    }

    #[test]
    fn test_storage_cycle() -> Result<()> {
        let dir = tempdir()?;
        let storage = AuraStorage::new(dir.path())?;

        let record = StoredRecord {
            id: "test_id_1".to_string(),
            dna: "user_core".to_string(),
            timestamp: 123456789.0,
            intensity: 5.5,
            stability: 1.0,
            decay_velocity: 0.1,
            entropy: 0.2,
            sdr_indices: vec![1, 10, 100, 2000],
            text: "Hello Rust Storage".to_string(),
            offset: 0,
        };

        storage.append(&record)?;

        let loaded = storage.read("test_id_1")?.expect("Should find record");

        assert_eq!(loaded.id, record.id);
        assert_eq!(loaded.text, record.text);
        assert_eq!(loaded.sdr_indices, record.sdr_indices);
        assert_eq!(loaded.intensity, record.intensity);

        Ok(())
    }
}

/// Persist a rename by syncing the parent directory (POSIX only; Windows
/// has no directory handle to sync and MoveFileEx is durable on NTFS).
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

struct IndexEntry {
    id: String,
    dna: String,
    timestamp: f64,
    intensity: f32,
    stability: f32,
    decay_velocity: f32,
    entropy: f32,
    sdr_indices: Vec<u16>,
    encrypted: bool,
    text_bytes: Vec<u8>,
}

/// Read one record header and its text for index rebuilding.
///
/// Returns an error for any incomplete or implausible record so the caller can
/// treat it as a torn tail. Lengths are checked against the bytes remaining in
/// the file before allocating.
fn read_index_entry<R: Read + Seek>(file: &mut R, len: u64) -> std::io::Result<IndexEntry> {
    let mut id_bytes = [0u8; 32];
    file.read_exact(&mut id_bytes)?;
    let id = String::from_utf8_lossy(&id_bytes)
        .trim_matches('\0')
        .to_string();

    let mut dna_bytes = [0u8; 16];
    file.read_exact(&mut dna_bytes)?;
    let dna = String::from_utf8_lossy(&dna_bytes)
        .trim_matches('\0')
        .to_string();

    let timestamp = file.read_f64::<LittleEndian>()?;
    let intensity = file.read_f32::<LittleEndian>()?;
    let stability = file.read_f32::<LittleEndian>()?;
    let decay_velocity = file.read_f32::<LittleEndian>()?;
    let entropy = file.read_f32::<LittleEndian>()?;

    let sdr_count = file.read_u16::<LittleEndian>()?;
    let text_len = file.read_u32::<LittleEndian>()?;

    // Encryption flag (V4)
    let encrypted = file.read_u8()? == 0x01;

    let remaining = len.saturating_sub(file.stream_position()?);
    if u64::from(sdr_count) * 2 + u64::from(text_len) > remaining {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "record extends past end of file",
        ));
    }

    let mut sdr_indices = Vec::with_capacity(sdr_count as usize);
    for _ in 0..sdr_count {
        sdr_indices.push(file.read_u16::<LittleEndian>()?);
    }

    let mut text_bytes = vec![0u8; text_len as usize];
    file.read_exact(&mut text_bytes)?;

    Ok(IndexEntry {
        id,
        dna,
        timestamp,
        intensity,
        stability,
        decay_velocity,
        entropy,
        sdr_indices,
        encrypted,
        text_bytes,
    })
}
