//! Portable single-file `.aura` container.
//!
//! This is an additive snapshot format, not the live authoritative store.
//! Version 2 appends committed generations and reuses unchanged segments.
//! Import always targets a new directory so a failed extraction cannot
//! partially overwrite a running Aura instance.

use anyhow::{anyhow, Context, Result};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use fs2::FileExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static MUTATION_LOCK: once_cell::sync::Lazy<parking_lot::Mutex<()>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(()));

const MUTATION_LOCK_TIMEOUT: Duration = Duration::from_secs(30);
const MUTATION_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const MAGIC: &[u8; 4] = b"AUPC";
const FRAME_MAGIC: &[u8; 4] = b"AUGN";
const LEGACY_VERSION: u16 = 1;
const VERSION: u16 = 2;
const FRAME_VERSION: u16 = 1;
const HEADER_SIZE: u64 = 64;
const FRAME_HEADER_SIZE: u64 = 80;
const MAX_TOC_SIZE: u64 = 16 * 1024 * 1024;
const MAX_SEGMENTS: usize = 4096;
const MAX_SEGMENT_SIZE: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_SIZE: u64 = 8 * 1024 * 1024 * 1024;
const SIGNATURE_ALGORITHM: &str = "ed25519-aura-manifest-v1";
const CHECKPOINT_FORMAT: &str = "aura-authenticity-checkpoint";
const CHECKPOINT_VERSION: u16 = 1;
const MAX_CHECKPOINT_SIZE: u64 = 16 * 1024;

struct CapsuleMutationGuard {
    file: File,
}

impl Drop for CapsuleMutationGuard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn is_lock_contention(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return true;
    }
    #[cfg(windows)]
    {
        // LockFileEx reports ERROR_LOCK_VIOLATION rather than WouldBlock.
        if error.raw_os_error() == Some(33) {
            return true;
        }
    }
    false
}

fn mutation_lock_path(container: &Path) -> Result<PathBuf> {
    let normalized = if container.exists() {
        fs::canonicalize(container)?
    } else {
        let parent = container
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let file_name = container
            .file_name()
            .ok_or_else(|| anyhow!("Aura container path must include a file name"))?;
        fs::canonicalize(parent)?.join(file_name)
    };
    let file_name = normalized
        .file_name()
        .ok_or_else(|| anyhow!("Aura container path must include a file name"))?;
    let mut lock_name = file_name.to_os_string();
    lock_name.push(".lock");
    Ok(normalized.with_file_name(lock_name))
}

fn acquire_mutation_lock(container: &Path, timeout: Duration) -> Result<CapsuleMutationGuard> {
    let lock_path = mutation_lock_path(container)?;
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "Failed to create Aura container lock directory: {}",
                parent.display()
            )
        })?;
    }
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| {
            format!(
                "Failed to open Aura container mutation lock: {}",
                lock_path.display()
            )
        })?;
    let started = Instant::now();
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(CapsuleMutationGuard { file }),
            Err(error) if is_lock_contention(&error) => {
                if started.elapsed() >= timeout {
                    anyhow::bail!(
                        "Timed out after {} ms waiting for Aura container mutation lock: {}",
                        timeout.as_millis(),
                        lock_path.display()
                    );
                }
                std::thread::sleep(
                    MUTATION_LOCK_RETRY_INTERVAL.min(timeout.saturating_sub(started.elapsed())),
                );
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "Failed to acquire Aura container mutation lock: {}",
                        lock_path.display()
                    )
                });
            }
        }
    }
}

fn with_mutation_lock<T>(container: &Path, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let _process_guard = MUTATION_LOCK.lock();
    let _file_guard = acquire_mutation_lock(container, MUTATION_LOCK_TIMEOUT)?;
    operation()
}

fn with_container_checkpoint_locks<T>(
    container: &Path,
    checkpoint: &Path,
    operation: impl FnOnce() -> Result<T>,
) -> Result<T> {
    if container == checkpoint {
        anyhow::bail!("Aura authenticity checkpoint must be separate from the container");
    }
    let _process_guard = MUTATION_LOCK.lock();
    let _container_guard = acquire_mutation_lock(container, MUTATION_LOCK_TIMEOUT)?;
    let _checkpoint_guard = acquire_mutation_lock(checkpoint, MUTATION_LOCK_TIMEOUT)?;
    operation()
}

fn exclude_container_operational_files(
    files: &mut Vec<(String, PathBuf)>,
    container: &Path,
) -> Result<()> {
    let mut excluded = vec![fs::canonicalize(mutation_lock_path(container)?)?];
    if container.exists() {
        excluded.push(fs::canonicalize(container)?);
    }
    files.retain(|(_, path)| {
        fs::canonicalize(path)
            .map(|candidate| !excluded.contains(&candidate))
            .unwrap_or(true)
    });
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapsuleCodec {
    Raw,
    Zstd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleSegment {
    pub name: String,
    pub offset: u64,
    pub stored_size: u64,
    pub original_size: u64,
    pub codec: CapsuleCodec,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleToc {
    pub format: String,
    pub version: u16,
    #[serde(default)]
    pub generation: u64,
    pub created_at: u64,
    pub segments: Vec<CapsuleSegment>,
    pub original_size: u64,
    pub stored_size: u64,
    #[serde(default)]
    pub holds: Vec<CapsuleGenerationHold>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authenticity: Option<CapsuleGenerationAuthenticity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapsuleGenerationAuthenticity {
    pub algorithm: String,
    pub public_key: String,
    pub manifest_sha256: String,
    pub previous_manifest_sha256: Option<String>,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleSigningKeyPair {
    pub private_key: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleAuthenticityReport {
    pub path: PathBuf,
    pub verified: bool,
    pub generation_count: usize,
    pub signed_generation_count: usize,
    pub unsigned_generation_count: usize,
    pub all_generations_signed: bool,
    pub chain_start_generation: Option<u64>,
    pub detached_prefix: bool,
    pub public_key: Option<String>,
    pub latest_manifest_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleAuthenticityCheckpoint {
    pub format: String,
    pub version: u16,
    pub public_key: String,
    pub generation: u64,
    pub manifest_sha256: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleCheckpointVerificationReport {
    pub checkpoint_path: PathBuf,
    pub public_key: String,
    pub checkpoint_generation: u64,
    pub current_generation: u64,
    pub current_manifest_sha256: String,
    pub advanced_by: u64,
    pub checkpoint_is_current: bool,
}

#[derive(Serialize)]
struct CapsuleSignedManifest<'a> {
    domain: &'static str,
    format: &'a str,
    version: u16,
    generation: u64,
    created_at: u64,
    original_size: u64,
    segments: Vec<CapsuleSignedSegment<'a>>,
    holds: &'a [CapsuleGenerationHold],
    previous_manifest_sha256: Option<&'a str>,
}

#[derive(Serialize)]
struct CapsuleSignedSegment<'a> {
    name: &'a str,
    original_size: u64,
    sha256: &'a str,
}

pub fn generate_signing_key() -> CapsuleSigningKeyPair {
    let mut private_key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut private_key);
    let signing_key = SigningKey::from_bytes(&private_key);
    CapsuleSigningKeyPair {
        private_key: hex::encode(signing_key.to_bytes()),
        public_key: hex::encode(signing_key.verifying_key().to_bytes()),
    }
}

fn parse_signing_key(value: &str) -> Result<SigningKey> {
    let decoded = hex::decode(value)
        .context("Aura container signing key must be 64 hexadecimal characters")?;
    let bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| anyhow!("Aura container signing key must encode exactly 32 bytes"))?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn parse_verifying_key(value: &str) -> Result<VerifyingKey> {
    let decoded = hex::decode(value)
        .context("Aura container public key must be 64 hexadecimal characters")?;
    let bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| anyhow!("Aura container public key must encode exactly 32 bytes"))?;
    VerifyingKey::from_bytes(&bytes).context("Invalid Aura container Ed25519 public key")
}

fn signed_manifest_bytes(
    toc: &CapsuleToc,
    previous_manifest_sha256: Option<&str>,
) -> Result<Vec<u8>> {
    let manifest = CapsuleSignedManifest {
        domain: SIGNATURE_ALGORITHM,
        format: &toc.format,
        version: toc.version,
        generation: toc.generation,
        created_at: toc.created_at,
        original_size: toc.original_size,
        segments: toc
            .segments
            .iter()
            .map(|segment| CapsuleSignedSegment {
                name: &segment.name,
                original_size: segment.original_size,
                sha256: &segment.sha256,
            })
            .collect(),
        holds: &toc.holds,
        previous_manifest_sha256,
    };
    Ok(serde_json::to_vec(&manifest)?)
}

fn sign_toc(
    toc: &mut CapsuleToc,
    previous_manifest_sha256: Option<&str>,
    signing_key: &SigningKey,
) -> Result<()> {
    let manifest = signed_manifest_bytes(toc, previous_manifest_sha256)?;
    let digest = Sha256::digest(&manifest);
    let signature = signing_key.sign(&manifest);
    toc.authenticity = Some(CapsuleGenerationAuthenticity {
        algorithm: SIGNATURE_ALGORITHM.into(),
        public_key: hex::encode(signing_key.verifying_key().to_bytes()),
        manifest_sha256: hex::encode(digest),
        previous_manifest_sha256: previous_manifest_sha256.map(str::to_string),
        signature: hex::encode(signature.to_bytes()),
    });
    Ok(())
}

fn verify_toc_authenticity(toc: &CapsuleToc) -> Result<Option<&CapsuleGenerationAuthenticity>> {
    let Some(authenticity) = toc.authenticity.as_ref() else {
        return Ok(None);
    };
    if authenticity.algorithm != SIGNATURE_ALGORITHM {
        anyhow::bail!(
            "Unsupported Aura generation signature algorithm: {}",
            authenticity.algorithm
        );
    }
    let verifying_key = parse_verifying_key(&authenticity.public_key)?;
    let signature_bytes = hex::decode(&authenticity.signature)
        .context("Aura generation signature is not valid hexadecimal")?;
    let signature_bytes: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| anyhow!("Aura generation signature must encode exactly 64 bytes"))?;
    let manifest = signed_manifest_bytes(toc, authenticity.previous_manifest_sha256.as_deref())?;
    let actual_digest = sha256_hex(&manifest);
    if actual_digest != authenticity.manifest_sha256 {
        anyhow::bail!(
            "Aura generation {} signed manifest digest mismatch (expected {}, got {})",
            toc.generation,
            authenticity.manifest_sha256,
            actual_digest
        );
    }
    verifying_key
        .verify(&manifest, &Signature::from_bytes(&signature_bytes))
        .with_context(|| {
            format!(
                "Aura generation {} signature verification failed",
                toc.generation
            )
        })?;
    Ok(Some(authenticity))
}

fn validate_signing_transition(
    previous: &CapsuleToc,
    signing_key: Option<&SigningKey>,
) -> Result<()> {
    let Some(previous_authenticity) = previous.authenticity.as_ref() else {
        return Ok(());
    };
    let signing_key = signing_key.ok_or_else(|| {
        anyhow!(
            "Aura container generation {} is signed; use a signed mutation API",
            previous.generation
        )
    })?;
    let supplied_public_key = hex::encode(signing_key.verifying_key().to_bytes());
    if supplied_public_key != previous_authenticity.public_key {
        anyhow::bail!("Aura container signing key does not match the active signature chain");
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapsuleGenerationHold {
    pub generation: u64,
    pub label: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleExportReport {
    pub output_path: PathBuf,
    pub segment_count: usize,
    pub original_size: u64,
    pub container_size: u64,
    pub compressed_segment_count: usize,
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleAppendReport {
    pub output_path: PathBuf,
    pub generation: u64,
    pub segment_count: usize,
    pub changed_segment_count: usize,
    pub reused_segment_count: usize,
    pub removed_segment_count: usize,
    pub appended_bytes: u64,
    pub container_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleImportReport {
    pub target_path: PathBuf,
    pub segment_count: usize,
    pub restored_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleSelectionReport {
    pub segment_count: usize,
    pub total_size: u64,
    pub segments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleGenerationInfo {
    pub generation: u64,
    pub created_at: u64,
    pub segment_count: usize,
    pub original_size: u64,
    pub stored_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleCompactionReport {
    pub path: PathBuf,
    pub kept_generations: Vec<u64>,
    pub dropped_generation_count: usize,
    pub copied_segment_count: usize,
    pub reused_segment_count: usize,
    pub previous_size: u64,
    pub compacted_size: u64,
    pub reclaimed_bytes: u64,
    pub trailing_bytes_removed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleSegmentDelta {
    pub name: String,
    pub previous_sha256: String,
    pub current_sha256: String,
    pub previous_size: u64,
    pub current_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleGenerationDiff {
    pub from_generation: u64,
    pub to_generation: u64,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<CapsuleSegmentDelta>,
    pub unchanged: Vec<String>,
    pub original_size_delta: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CapsuleRetentionPolicy {
    pub min_generations: usize,
    pub max_generations: Option<usize>,
    pub max_age_seconds: Option<u64>,
    pub max_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleRetentionReport {
    pub evaluated_generation_count: usize,
    pub selected_keep_last: usize,
    pub age_cutoff: Option<u64>,
    pub estimated_compacted_size: u64,
    pub size_target_met: bool,
    pub reasons: Vec<String>,
    pub compaction: CapsuleCompactionReport,
    pub plan: CapsuleRetentionPlan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleAppendRetentionReport {
    pub append: CapsuleAppendReport,
    pub retention: CapsuleRetentionReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleRetentionPlan {
    pub evaluated_generations: Vec<u64>,
    pub keep_generations: Vec<u64>,
    pub drop_generations: Vec<u64>,
    pub selected_keep_last: usize,
    pub age_cutoff: Option<u64>,
    pub estimated_compacted_size: u64,
    pub size_target_met: bool,
    pub held_generations: Vec<u64>,
    pub hold_floor_generation: Option<u64>,
    pub limits_blocked_by_holds: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleHoldReport {
    pub control_generation: u64,
    pub held_generation: u64,
    pub active_holds: Vec<CapsuleGenerationHold>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleRetentionSchedulerStatus {
    pub path: PathBuf,
    pub running: bool,
    pub interval_seconds: u64,
    pub run_count: u64,
    pub last_run_at: Option<u64>,
    pub last_reclaimed_bytes: Option<u64>,
    pub last_error: Option<String>,
}

pub struct CapsuleRetentionScheduler {
    stop: std::sync::mpsc::Sender<()>,
    handle: Option<std::thread::JoinHandle<()>>,
    status: std::sync::Arc<parking_lot::RwLock<CapsuleRetentionSchedulerStatus>>,
}

impl CapsuleRetentionScheduler {
    pub fn start(
        path: PathBuf,
        policy: CapsuleRetentionPolicy,
        interval_seconds: u64,
    ) -> Result<Self> {
        if interval_seconds == 0 {
            anyhow::bail!("Aura retention scheduler interval must be at least one second");
        }
        plan_retention_policy(&path, &policy)?;
        let (stop, receiver) = std::sync::mpsc::channel();
        let status =
            std::sync::Arc::new(parking_lot::RwLock::new(CapsuleRetentionSchedulerStatus {
                path: path.clone(),
                running: true,
                interval_seconds,
                run_count: 0,
                last_run_at: None,
                last_reclaimed_bytes: None,
                last_error: None,
            }));
        let worker_status = status.clone();
        let handle = std::thread::Builder::new()
            .name("aura-capsule-retention".into())
            .spawn(move || {
                loop {
                    match receiver.recv_timeout(std::time::Duration::from_secs(interval_seconds)) {
                        Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    let result = apply_retention_policy(&path, &policy);
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    let mut status = worker_status.write();
                    status.run_count = status.run_count.saturating_add(1);
                    status.last_run_at = Some(now);
                    match result {
                        Ok(report) => {
                            status.last_reclaimed_bytes = Some(report.compaction.reclaimed_bytes);
                            status.last_error = None;
                        }
                        Err(error) => {
                            status.last_error = Some(error.to_string());
                        }
                    }
                }
                worker_status.write().running = false;
            })?;
        Ok(Self {
            stop,
            handle: Some(handle),
            status,
        })
    }

    pub fn status(&self) -> CapsuleRetentionSchedulerStatus {
        self.status.read().clone()
    }

    pub fn stop(&mut self) {
        let _ = self.stop.send(());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.status.write().running = false;
    }
}

impl Drop for CapsuleRetentionScheduler {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn export_directory(source: &Path, output: &Path) -> Result<CapsuleExportReport> {
    with_mutation_lock(output, || export_directory_unlocked(source, output, None))
}

pub fn export_directory_signed(
    source: &Path,
    output: &Path,
    signing_key: &str,
) -> Result<CapsuleExportReport> {
    let signing_key = parse_signing_key(signing_key)?;
    with_mutation_lock(output, || {
        export_directory_unlocked(source, output, Some(&signing_key))
    })
}

fn export_directory_unlocked(
    source: &Path,
    output: &Path,
    signing_key: Option<&SigningKey>,
) -> Result<CapsuleExportReport> {
    validate_source(source)?;
    if output.exists() {
        anyhow::bail!(
            "Refusing to overwrite existing container: {}",
            output.display()
        );
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut files = collect_artifacts(source)?;
    exclude_container_operational_files(&mut files, output)?;
    if files.is_empty() {
        anyhow::bail!("No Aura artifacts found in {}", source.display());
    }
    if files.len() > MAX_SEGMENTS {
        anyhow::bail!("Aura container exceeds maximum segment count");
    }

    let temporary = output.with_extension("aura.tmp");
    let result = (|| -> Result<CapsuleExportReport> {
        let mut writer = File::create(&temporary)?;
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        write_v2_header(&mut writer, created_at)?;
        writer.flush()?;
        writer.sync_all()?;
        let generation = append_generation(&mut writer, &files, None, 1, signing_key)?;
        drop(writer);
        fs::rename(&temporary, output)?;

        Ok(CapsuleExportReport {
            output_path: output.to_path_buf(),
            segment_count: generation.toc.segments.len(),
            original_size: generation.toc.original_size,
            container_size: fs::metadata(output)?.len(),
            compressed_segment_count: generation.compressed_segment_count,
            generation: generation.toc.generation,
        })
    })();

    if result.is_err() && temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Append a new logical snapshot while reusing unchanged segments from the
/// latest committed v2 generation.
pub fn append_directory(source: &Path, container: &Path) -> Result<CapsuleAppendReport> {
    with_mutation_lock(container, || {
        append_directory_unlocked(source, container, None)
    })
}

pub fn append_directory_signed(
    source: &Path,
    container: &Path,
    signing_key: &str,
) -> Result<CapsuleAppendReport> {
    let signing_key = parse_signing_key(signing_key)?;
    with_mutation_lock(container, || {
        append_directory_unlocked(source, container, Some(&signing_key))
    })
}

fn append_directory_unlocked(
    source: &Path,
    container: &Path,
    signing_key: Option<&SigningKey>,
) -> Result<CapsuleAppendReport> {
    validate_source(source)?;
    let state = inspect_v2_state(container)?;
    validate_signing_transition(&state.toc, signing_key)?;
    let before_size = fs::metadata(container)?.len();
    let mut files = collect_artifacts(source)?;
    exclude_container_operational_files(&mut files, container)?;
    if files.is_empty() {
        anyhow::bail!("No Aura artifacts found in {}", source.display());
    }
    let mut writer = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(container)?;
    if before_size != state.committed_end {
        writer.set_len(state.committed_end)?;
    }
    writer.seek(SeekFrom::Start(state.committed_end))?;
    let generation = append_generation(
        &mut writer,
        &files,
        Some(&state.toc),
        state.toc.generation + 1,
        signing_key,
    )?;
    let container_size = writer.metadata()?.len();
    Ok(CapsuleAppendReport {
        output_path: container.to_path_buf(),
        generation: generation.toc.generation,
        segment_count: generation.toc.segments.len(),
        changed_segment_count: generation.changed_segment_count,
        reused_segment_count: generation.reused_segment_count,
        removed_segment_count: generation.removed_segment_count,
        appended_bytes: generation.appended_bytes,
        container_size,
    })
}

pub fn append_directory_with_retention(
    source: &Path,
    container: &Path,
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleAppendRetentionReport> {
    with_mutation_lock(container, || {
        let append = append_directory_unlocked(source, container, None)?;
        let retention = apply_retention_policy_unlocked(container, policy)?;
        Ok(CapsuleAppendRetentionReport { append, retention })
    })
}

pub fn append_directory_signed_with_retention(
    source: &Path,
    container: &Path,
    signing_key: &str,
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleAppendRetentionReport> {
    let signing_key = parse_signing_key(signing_key)?;
    with_mutation_lock(container, || {
        let append = append_directory_unlocked(source, container, Some(&signing_key))?;
        let retention = apply_retention_policy_unlocked(container, policy)?;
        Ok(CapsuleAppendRetentionReport { append, retention })
    })
}

pub fn set_generation_hold(path: &Path, generation: u64, label: &str) -> Result<CapsuleHoldReport> {
    with_mutation_lock(path, || {
        update_generation_hold_unlocked(path, generation, Some(label), None)
    })
}

pub fn release_generation_hold(path: &Path, generation: u64) -> Result<CapsuleHoldReport> {
    with_mutation_lock(path, || {
        update_generation_hold_unlocked(path, generation, None, None)
    })
}

pub fn set_generation_hold_signed(
    path: &Path,
    generation: u64,
    label: &str,
    signing_key: &str,
) -> Result<CapsuleHoldReport> {
    let signing_key = parse_signing_key(signing_key)?;
    with_mutation_lock(path, || {
        update_generation_hold_unlocked(path, generation, Some(label), Some(&signing_key))
    })
}

pub fn release_generation_hold_signed(
    path: &Path,
    generation: u64,
    signing_key: &str,
) -> Result<CapsuleHoldReport> {
    let signing_key = parse_signing_key(signing_key)?;
    with_mutation_lock(path, || {
        update_generation_hold_unlocked(path, generation, None, Some(&signing_key))
    })
}

fn update_generation_hold_unlocked(
    path: &Path,
    generation: u64,
    label: Option<&str>,
    signing_key: Option<&SigningKey>,
) -> Result<CapsuleHoldReport> {
    let state = inspect_v2_state(path)?;
    validate_signing_transition(&state.toc, signing_key)?;
    if !state
        .generations
        .iter()
        .any(|toc| toc.generation == generation)
    {
        anyhow::bail!("Aura container generation not found: {generation}");
    }
    let normalized_label = label.map(str::trim);
    if normalized_label.is_some_and(|value| {
        value.is_empty()
            || value.len() > 256
            || value.chars().any(|character| character.is_control())
    }) {
        anyhow::bail!("Aura generation hold label must be 1-256 printable characters");
    }
    if normalized_label.is_some_and(|label| {
        state
            .toc
            .holds
            .iter()
            .any(|hold| hold.generation == generation && hold.label == label)
    }) {
        return Ok(CapsuleHoldReport {
            control_generation: state.toc.generation,
            held_generation: generation,
            active_holds: state.toc.holds.clone(),
        });
    }

    let mut holds = state.toc.holds.clone();
    holds.retain(|hold| hold.generation != generation);
    if let Some(label) = normalized_label {
        holds.push(CapsuleGenerationHold {
            generation,
            label: label.to_string(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
    }
    holds.sort_by_key(|hold| hold.generation);
    if holds == state.toc.holds {
        return Ok(CapsuleHoldReport {
            control_generation: state.toc.generation,
            held_generation: generation,
            active_holds: holds,
        });
    }

    let file_size = fs::metadata(path)?.len();
    let mut writer = fs::OpenOptions::new().read(true).write(true).open(path)?;
    if file_size != state.committed_end {
        writer.set_len(state.committed_end)?;
    }
    writer.seek(SeekFrom::Start(state.committed_end))?;
    let control_generation = state
        .toc
        .generation
        .checked_add(1)
        .ok_or_else(|| anyhow!("Aura generation number overflow"))?;
    write_control_generation(
        &mut writer,
        &state.toc,
        control_generation,
        holds.clone(),
        signing_key,
    )?;
    Ok(CapsuleHoldReport {
        control_generation,
        held_generation: generation,
        active_holds: holds,
    })
}

/// Rewrite a v2 container in place, retaining only the latest committed
/// generations and the payloads reachable from them.
pub fn compact_in_place(path: &Path, keep_last: usize) -> Result<CapsuleCompactionReport> {
    with_mutation_lock(path, || compact_in_place_unlocked(path, keep_last))
}

fn compact_in_place_unlocked(path: &Path, keep_last: usize) -> Result<CapsuleCompactionReport> {
    if keep_last == 0 {
        anyhow::bail!("Aura container compaction must retain at least one generation");
    }
    let state = inspect_v2_state(path)?;
    let previous_size = fs::metadata(path)?.len();
    let trailing_bytes_removed = previous_size.saturating_sub(state.committed_end);
    let mut effective_keep_last = keep_last.min(state.generations.len());
    if let Some(earliest_hold) = state.toc.holds.iter().map(|hold| hold.generation).min() {
        let hold_index = state
            .generations
            .iter()
            .position(|toc| toc.generation == earliest_hold)
            .ok_or_else(|| anyhow!("Held Aura generation is not retained"))?;
        effective_keep_last = effective_keep_last.max(state.generations.len() - hold_index);
    }
    let keep_from = state.generations.len().saturating_sub(effective_keep_last);
    let mut retained: Vec<CapsuleToc> = state.generations[keep_from..].to_vec();
    let retained_ids: std::collections::HashSet<u64> =
        retained.iter().map(|toc| toc.generation).collect();
    for toc in &mut retained {
        if toc.authenticity.is_none() {
            toc.holds
                .retain(|hold| retained_ids.contains(&hold.generation));
        }
    }
    let kept_generations: Vec<u64> = retained.iter().map(|toc| toc.generation).collect();
    let dropped_generation_count = state.generations.len() - retained.len();

    if dropped_generation_count == 0 && trailing_bytes_removed == 0 {
        return Ok(CapsuleCompactionReport {
            path: path.to_path_buf(),
            kept_generations,
            dropped_generation_count,
            copied_segment_count: 0,
            reused_segment_count: 0,
            previous_size,
            compacted_size: previous_size,
            reclaimed_bytes: 0,
            trailing_bytes_removed: 0,
        });
    }

    let temporary = path.with_extension("aura.compact.tmp");
    if temporary.exists() {
        anyhow::bail!(
            "Aura compaction temporary path already exists: {}",
            temporary.display()
        );
    }
    #[cfg(windows)]
    {
        let backup = compaction_backup_path(path);
        if backup.exists() {
            anyhow::bail!(
                "Aura compaction backup path already exists: {}",
                backup.display()
            );
        }
    }

    let result = (|| -> Result<CapsuleCompactionReport> {
        let mut source = File::open(path)?;
        let mut output = fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&temporary)?;
        write_v2_header(&mut output, retained[0].created_at)?;
        output.flush()?;
        output.sync_all()?;

        let mut previous_compacted = None;
        let mut copied_segment_count = 0usize;
        let mut reused_segment_count = 0usize;
        for toc in &retained {
            let (compacted, copied, reused) =
                copy_generation_frame(&mut source, &mut output, toc, previous_compacted.as_ref())?;
            copied_segment_count += copied;
            reused_segment_count += reused;
            previous_compacted = Some(compacted);
        }
        output.flush()?;
        output.sync_all()?;
        drop(output);
        drop(source);

        let compacted_state = inspect_v2_state(&temporary)?;
        let compacted_generations: Vec<u64> = compacted_state
            .generations
            .iter()
            .map(|toc| toc.generation)
            .collect();
        if compacted_generations != kept_generations {
            anyhow::bail!("Compacted Aura container generation history mismatch");
        }
        verify_generation_set(&temporary, &compacted_state.generations)?;
        let compacted_size = fs::metadata(&temporary)?.len();
        replace_compacted_file(&temporary, path)?;

        Ok(CapsuleCompactionReport {
            path: path.to_path_buf(),
            kept_generations,
            dropped_generation_count,
            copied_segment_count,
            reused_segment_count,
            previous_size,
            compacted_size,
            reclaimed_bytes: previous_size.saturating_sub(compacted_size),
            trailing_bytes_removed,
        })
    })();

    if result.is_err() && temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn apply_retention_policy(
    path: &Path,
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleRetentionReport> {
    with_mutation_lock(path, || apply_retention_policy_unlocked(path, policy))
}

fn apply_retention_policy_unlocked(
    path: &Path,
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleRetentionReport> {
    let plan = plan_retention_policy(path, policy)?;
    let compaction = compact_in_place_unlocked(path, plan.selected_keep_last)?;
    let size_target_met = policy
        .max_size_bytes
        .is_none_or(|maximum| compaction.compacted_size <= maximum);
    return Ok(CapsuleRetentionReport {
        evaluated_generation_count: plan.evaluated_generations.len(),
        selected_keep_last: plan.selected_keep_last,
        age_cutoff: plan.age_cutoff,
        estimated_compacted_size: plan.estimated_compacted_size,
        size_target_met,
        reasons: plan.reasons.clone(),
        compaction,
        plan,
    });
}

pub fn plan_retention_policy(
    path: &Path,
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleRetentionPlan> {
    validate_retention_policy(policy)?;
    let state = inspect_v2_state(path)?;
    build_retention_plan(&state.generations, policy)
}

fn validate_retention_policy(policy: &CapsuleRetentionPolicy) -> Result<()> {
    if policy.max_generations.is_none()
        && policy.max_age_seconds.is_none()
        && policy.max_size_bytes.is_none()
    {
        anyhow::bail!("Aura retention policy must define at least one limit");
    }
    if policy.max_generations == Some(0) {
        anyhow::bail!("max_generations must be at least one");
    }
    if policy.max_size_bytes == Some(0) {
        anyhow::bail!("max_size_bytes must be greater than zero");
    }
    Ok(())
}

fn build_retention_plan(
    generations: &[CapsuleToc],
    policy: &CapsuleRetentionPolicy,
) -> Result<CapsuleRetentionPlan> {
    let total = generations.len();
    if total == 0 {
        anyhow::bail!("Aura retention planning requires committed generations");
    }
    let minimum = policy.min_generations.max(1).min(total);
    if policy
        .max_generations
        .is_some_and(|maximum| maximum < minimum)
    {
        anyhow::bail!("max_generations cannot be lower than min_generations");
    }

    let mut keep_last = total;
    let mut reasons = Vec::new();
    if let Some(maximum) = policy.max_generations {
        let selected = maximum.max(minimum).min(total);
        if selected < keep_last {
            reasons.push(format!("max_generations={maximum}"));
            keep_last = selected;
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let age_cutoff = policy
        .max_age_seconds
        .map(|maximum_age| now.saturating_sub(maximum_age));
    if let Some(cutoff) = age_cutoff {
        let recent = generations
            .iter()
            .rev()
            .take_while(|toc| toc.created_at >= cutoff)
            .count();
        let selected = recent.max(minimum).min(total);
        if selected < keep_last {
            reasons.push(format!(
                "max_age_seconds={}",
                policy.max_age_seconds.unwrap_or_default()
            ));
            keep_last = selected;
        }
    }

    if let Some(maximum_size) = policy.max_size_bytes {
        let before_size_limit = keep_last;
        while keep_last > minimum
            && estimate_compacted_size(&generations[total - keep_last..])? > maximum_size
        {
            keep_last -= 1;
        }
        if keep_last < before_size_limit {
            reasons.push(format!("max_size_bytes={maximum_size}"));
        }
    }

    let available: std::collections::HashSet<u64> =
        generations.iter().map(|toc| toc.generation).collect();
    let mut held_generations: Vec<u64> = generations
        .last()
        .into_iter()
        .flat_map(|toc| toc.holds.iter().map(|hold| hold.generation))
        .collect();
    held_generations.sort_unstable();
    held_generations.dedup();
    if held_generations
        .iter()
        .any(|generation| !available.contains(generation))
    {
        anyhow::bail!("Aura container contains a hold for a non-retained generation");
    }
    let hold_floor_generation = held_generations.first().copied();
    let requested_keep_last = keep_last;
    if let Some(floor) = hold_floor_generation {
        let floor_index = generations
            .iter()
            .position(|toc| toc.generation == floor)
            .ok_or_else(|| anyhow!("Held Aura generation is not retained"))?;
        keep_last = keep_last.max(total - floor_index);
        if keep_last > requested_keep_last {
            reasons.push(format!("legal_hold_floor={floor}"));
        }
    }

    let estimated_compacted_size = estimate_compacted_size(&generations[total - keep_last..])?;
    let size_target_met = policy
        .max_size_bytes
        .is_none_or(|maximum| estimated_compacted_size <= maximum);
    if reasons.is_empty() {
        reasons.push("policy_already_satisfied".into());
    }
    let evaluated_generations: Vec<u64> = generations.iter().map(|toc| toc.generation).collect();
    let split = total - keep_last;
    Ok(CapsuleRetentionPlan {
        evaluated_generations: evaluated_generations.clone(),
        keep_generations: evaluated_generations[split..].to_vec(),
        drop_generations: evaluated_generations[..split].to_vec(),
        selected_keep_last: keep_last,
        age_cutoff,
        estimated_compacted_size,
        size_target_met,
        held_generations,
        hold_floor_generation,
        limits_blocked_by_holds: keep_last > requested_keep_last,
        reasons,
    })
}

pub fn inspect(path: &Path) -> Result<CapsuleToc> {
    let mut file = File::open(path)?;
    match read_container_version(&mut file)? {
        LEGACY_VERSION => inspect_v1(&mut file),
        VERSION => Ok(scan_v2(&mut file)?.toc),
        version => anyhow::bail!("Unsupported Aura container version: {version}"),
    }
}

pub fn list_generations(path: &Path) -> Result<Vec<CapsuleGenerationInfo>> {
    let mut file = File::open(path)?;
    match read_container_version(&mut file)? {
        LEGACY_VERSION => {
            let toc = inspect_v1(&mut file)?;
            Ok(vec![generation_info(&toc)])
        }
        VERSION => Ok(scan_v2(&mut file)?
            .generations
            .iter()
            .map(generation_info)
            .collect()),
        version => anyhow::bail!("Unsupported Aura container version: {version}"),
    }
}

pub fn verify_authenticity(
    path: &Path,
    trusted_public_key: Option<&str>,
    require_all_signed: bool,
) -> Result<CapsuleAuthenticityReport> {
    let mut file = File::open(path)?;
    let version = read_container_version(&mut file)?;
    if version != VERSION {
        anyhow::bail!("Authenticity verification requires an Aura v2 container");
    }
    let state = scan_v2(&mut file)?;
    let signed: Vec<&CapsuleToc> = state
        .generations
        .iter()
        .filter(|toc| toc.authenticity.is_some())
        .collect();
    let signed_generation_count = signed.len();
    let unsigned_generation_count = state.generations.len() - signed_generation_count;
    if require_all_signed && unsigned_generation_count > 0 {
        anyhow::bail!(
            "Aura container has {unsigned_generation_count} unsigned retained generation(s)"
        );
    }
    let public_key = signed
        .first()
        .and_then(|toc| toc.authenticity.as_ref())
        .map(|authenticity| authenticity.public_key.clone());
    if let Some(trusted) = trusted_public_key {
        let trusted = hex::encode(parse_verifying_key(trusted)?.to_bytes());
        let actual = public_key.as_deref().ok_or_else(|| {
            anyhow!("Aura container has no signed generations to verify against the trusted key")
        })?;
        if actual != trusted {
            anyhow::bail!("Aura container signing identity does not match the trusted public key");
        }
    }
    let first_signed = signed.first().copied();
    Ok(CapsuleAuthenticityReport {
        path: path.to_path_buf(),
        verified: true,
        generation_count: state.generations.len(),
        signed_generation_count,
        unsigned_generation_count,
        all_generations_signed: unsigned_generation_count == 0,
        chain_start_generation: first_signed.map(|toc| toc.generation),
        detached_prefix: first_signed
            .and_then(|toc| toc.authenticity.as_ref())
            .is_some_and(|authenticity| authenticity.previous_manifest_sha256.is_some()),
        public_key,
        latest_manifest_sha256: signed
            .last()
            .and_then(|toc| toc.authenticity.as_ref())
            .map(|authenticity| authenticity.manifest_sha256.clone()),
    })
}

pub fn verify_authenticity_checkpoint(
    path: &Path,
    checkpoint_path: &Path,
) -> Result<CapsuleCheckpointVerificationReport> {
    with_container_checkpoint_locks(path, checkpoint_path, || {
        let checkpoint = read_authenticity_checkpoint(checkpoint_path)?;
        verify_authenticity_checkpoint_unlocked(path, checkpoint_path, &checkpoint)
    })
}

pub fn update_authenticity_checkpoint(
    path: &Path,
    checkpoint_path: &Path,
    trusted_public_key: &str,
) -> Result<CapsuleAuthenticityCheckpoint> {
    with_container_checkpoint_locks(path, checkpoint_path, || {
        let trusted_public_key = hex::encode(parse_verifying_key(trusted_public_key)?.to_bytes());
        if checkpoint_path.exists() {
            let previous = read_authenticity_checkpoint(checkpoint_path)?;
            if previous.public_key != trusted_public_key {
                anyhow::bail!(
                    "Aura authenticity checkpoint belongs to a different signing identity"
                );
            }
            verify_authenticity_checkpoint_unlocked(path, checkpoint_path, &previous)?;
        }
        let report = verify_authenticity(path, Some(&trusted_public_key), true)?;
        let toc = inspect_v2_state(path)?.toc;
        let manifest_sha256 = report
            .latest_manifest_sha256
            .ok_or_else(|| anyhow!("Aura container has no signed manifest to checkpoint"))?;
        let checkpoint = CapsuleAuthenticityCheckpoint {
            format: CHECKPOINT_FORMAT.into(),
            version: CHECKPOINT_VERSION,
            public_key: trusted_public_key,
            generation: toc.generation,
            manifest_sha256,
            updated_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        write_authenticity_checkpoint(checkpoint_path, &checkpoint)?;
        Ok(checkpoint)
    })
}

fn verify_authenticity_checkpoint_unlocked(
    path: &Path,
    checkpoint_path: &Path,
    checkpoint: &CapsuleAuthenticityCheckpoint,
) -> Result<CapsuleCheckpointVerificationReport> {
    validate_authenticity_checkpoint(checkpoint)?;
    let report = verify_authenticity(path, Some(&checkpoint.public_key), true)?;
    let toc = inspect_v2_state(path)?.toc;
    let current_manifest_sha256 = report
        .latest_manifest_sha256
        .ok_or_else(|| anyhow!("Aura container has no signed manifest to compare"))?;
    if toc.generation < checkpoint.generation {
        anyhow::bail!(
            "Aura container rollback detected: checkpoint generation {}, current generation {}",
            checkpoint.generation,
            toc.generation
        );
    }
    if toc.generation == checkpoint.generation
        && current_manifest_sha256 != checkpoint.manifest_sha256
    {
        anyhow::bail!(
            "Aura container fork detected at checkpoint generation {}",
            checkpoint.generation
        );
    }
    Ok(CapsuleCheckpointVerificationReport {
        checkpoint_path: checkpoint_path.to_path_buf(),
        public_key: checkpoint.public_key.clone(),
        checkpoint_generation: checkpoint.generation,
        current_generation: toc.generation,
        current_manifest_sha256,
        advanced_by: toc.generation - checkpoint.generation,
        checkpoint_is_current: toc.generation == checkpoint.generation,
    })
}

fn read_authenticity_checkpoint(path: &Path) -> Result<CapsuleAuthenticityCheckpoint> {
    let metadata = fs::metadata(path).with_context(|| {
        format!(
            "Aura authenticity checkpoint does not exist: {}",
            path.display()
        )
    })?;
    if metadata.len() == 0 || metadata.len() > MAX_CHECKPOINT_SIZE {
        anyhow::bail!("Aura authenticity checkpoint has an invalid size");
    }
    let bytes = fs::read(path)?;
    let checkpoint: CapsuleAuthenticityCheckpoint =
        serde_json::from_slice(&bytes).context("Invalid Aura authenticity checkpoint JSON")?;
    validate_authenticity_checkpoint(&checkpoint)?;
    Ok(checkpoint)
}

fn validate_authenticity_checkpoint(checkpoint: &CapsuleAuthenticityCheckpoint) -> Result<()> {
    if checkpoint.format != CHECKPOINT_FORMAT
        || checkpoint.version != CHECKPOINT_VERSION
        || checkpoint.generation == 0
        || checkpoint.manifest_sha256.len() != 64
        || !checkpoint
            .manifest_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        anyhow::bail!("Invalid Aura authenticity checkpoint");
    }
    parse_verifying_key(&checkpoint.public_key)?;
    Ok(())
}

fn write_authenticity_checkpoint(
    path: &Path,
    checkpoint: &CapsuleAuthenticityCheckpoint,
) -> Result<()> {
    validate_authenticity_checkpoint(checkpoint)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("aura-checkpoint.tmp");
    if temporary.exists() {
        anyhow::bail!(
            "Aura checkpoint temporary path already exists: {}",
            temporary.display()
        );
    }
    let result = (|| -> Result<()> {
        let bytes = serde_json::to_vec_pretty(checkpoint)?;
        if bytes.len() as u64 > MAX_CHECKPOINT_SIZE {
            anyhow::bail!("Aura authenticity checkpoint exceeds its size limit");
        }
        let mut output = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        output.write_all(&bytes)?;
        output.flush()?;
        output.sync_all()?;
        drop(output);
        replace_checkpoint_file(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() && temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn inspect_generation(path: &Path, generation: u64) -> Result<CapsuleToc> {
    let mut file = File::open(path)?;
    match read_container_version(&mut file)? {
        LEGACY_VERSION if generation == 0 => inspect_v1(&mut file),
        LEGACY_VERSION => anyhow::bail!("Legacy Aura containers expose generation 0 only"),
        VERSION => scan_v2(&mut file)?
            .generations
            .into_iter()
            .find(|toc| toc.generation == generation)
            .ok_or_else(|| anyhow!("Aura container generation not found: {generation}")),
        version => anyhow::bail!("Unsupported Aura container version: {version}"),
    }
}

pub fn verify_generation(path: &Path, generation: u64) -> Result<CapsuleToc> {
    let toc = inspect_generation(path, generation)?;
    verify_generation_set(path, std::slice::from_ref(&toc))?;
    Ok(toc)
}

pub fn read_named_segment_at_generation(
    path: &Path,
    generation: u64,
    name: &str,
) -> Result<Vec<u8>> {
    safe_relative_path(name)?;
    let toc = inspect_generation(path, generation)?;
    let segment = toc
        .segments
        .iter()
        .find(|segment| segment.name == name)
        .ok_or_else(|| {
            anyhow!("Aura container segment not found in generation {generation}: {name}")
        })?;
    let mut file = File::open(path)?;
    let bytes = read_segment(&mut file, segment)?;
    if sha256_hex(&bytes) != segment.sha256 {
        anyhow::bail!("Checksum mismatch for segment {}", segment.name);
    }
    Ok(bytes)
}

pub fn import_generation_to_new_directory(
    path: &Path,
    target: &Path,
    generation: u64,
) -> Result<CapsuleImportReport> {
    let toc = verify_generation(path, generation)?;
    extract_segments(path, target, &toc.segments)
}

pub fn diff_generations(
    path: &Path,
    from_generation: u64,
    to_generation: u64,
) -> Result<CapsuleGenerationDiff> {
    let from = inspect_generation(path, from_generation)?;
    let to = inspect_generation(path, to_generation)?;
    let from_by_name: std::collections::BTreeMap<&str, &CapsuleSegment> = from
        .segments
        .iter()
        .map(|segment| (segment.name.as_str(), segment))
        .collect();
    let to_by_name: std::collections::BTreeMap<&str, &CapsuleSegment> = to
        .segments
        .iter()
        .map(|segment| (segment.name.as_str(), segment))
        .collect();
    let added = to_by_name
        .keys()
        .filter(|name| !from_by_name.contains_key(**name))
        .map(|name| (*name).to_string())
        .collect();
    let removed = from_by_name
        .keys()
        .filter(|name| !to_by_name.contains_key(**name))
        .map(|name| (*name).to_string())
        .collect();
    let mut changed = Vec::new();
    let mut unchanged = Vec::new();
    for (name, previous) in &from_by_name {
        let Some(current) = to_by_name.get(name) else {
            continue;
        };
        if previous.sha256 == current.sha256 && previous.original_size == current.original_size {
            unchanged.push((*name).to_string());
        } else {
            changed.push(CapsuleSegmentDelta {
                name: (*name).to_string(),
                previous_sha256: previous.sha256.clone(),
                current_sha256: current.sha256.clone(),
                previous_size: previous.original_size,
                current_size: current.original_size,
            });
        }
    }
    Ok(CapsuleGenerationDiff {
        from_generation,
        to_generation,
        added,
        removed,
        changed,
        unchanged,
        original_size_delta: to.original_size as i64 - from.original_size as i64,
    })
}

fn generation_info(toc: &CapsuleToc) -> CapsuleGenerationInfo {
    CapsuleGenerationInfo {
        generation: toc.generation,
        created_at: toc.created_at,
        segment_count: toc.segments.len(),
        original_size: toc.original_size,
        stored_size: toc.stored_size,
    }
}

fn inspect_v1(file: &mut File) -> Result<CapsuleToc> {
    let file_size = file.metadata()?.len();
    let header = read_v1_header(file)?;
    validate_v1_toc_range(header.toc_offset, header.toc_size, file_size)?;
    file.seek(SeekFrom::Start(header.toc_offset))?;
    let mut toc_bytes = vec![0u8; header.toc_size as usize];
    file.read_exact(&mut toc_bytes)?;
    if Sha256::digest(&toc_bytes).as_slice() != header.toc_checksum {
        anyhow::bail!("Aura container TOC checksum mismatch");
    }
    let toc: CapsuleToc = serde_json::from_slice(&toc_bytes)?;
    validate_toc(&toc, header.toc_offset, LEGACY_VERSION)?;
    if toc.created_at != header.created_at {
        anyhow::bail!("Aura container creation timestamp mismatch");
    }
    Ok(toc)
}

pub fn verify(path: &Path) -> Result<CapsuleToc> {
    let toc = inspect(path)?;
    let mut file = File::open(path)?;
    for segment in &toc.segments {
        let bytes = read_segment(&mut file, segment)?;
        if sha256_hex(&bytes) != segment.sha256 {
            anyhow::bail!("Checksum mismatch for segment {}", segment.name);
        }
    }
    Ok(toc)
}

pub fn read_named_segment(path: &Path, name: &str) -> Result<Vec<u8>> {
    safe_relative_path(name)?;
    let toc = inspect(path)?;
    let segment = toc
        .segments
        .iter()
        .find(|segment| segment.name == name)
        .ok_or_else(|| anyhow!("Aura container segment not found: {name}"))?;
    let mut file = File::open(path)?;
    let bytes = read_segment(&mut file, segment)?;
    if sha256_hex(&bytes) != segment.sha256 {
        anyhow::bail!("Checksum mismatch for segment {}", segment.name);
    }
    Ok(bytes)
}

pub fn verify_selected(path: &Path, names: &[String]) -> Result<CapsuleSelectionReport> {
    let toc = inspect(path)?;
    let selected = select_segments(&toc, names)?;
    let mut file = File::open(path)?;
    let mut total_size = 0u64;
    let mut verified = Vec::with_capacity(selected.len());
    for segment in selected {
        let bytes = read_segment(&mut file, &segment)?;
        if sha256_hex(&bytes) != segment.sha256 {
            anyhow::bail!("Checksum mismatch for segment {}", segment.name);
        }
        total_size += bytes.len() as u64;
        verified.push(segment.name.clone());
    }
    Ok(CapsuleSelectionReport {
        segment_count: verified.len(),
        total_size,
        segments: verified,
    })
}

pub fn import_to_new_directory(path: &Path, target: &Path) -> Result<CapsuleImportReport> {
    let toc = verify(path)?;
    extract_segments(path, target, &toc.segments)
}

pub fn import_authenticated_to_new_directory(
    path: &Path,
    target: &Path,
    trusted_public_key: &str,
    require_all_signed: bool,
) -> Result<CapsuleImportReport> {
    with_mutation_lock(path, || {
        verify_authenticity(path, Some(trusted_public_key), require_all_signed)?;
        let toc = verify(path)?;
        extract_segments(path, target, &toc.segments)
    })
}

pub fn extract_selected_to_new_directory(
    path: &Path,
    target: &Path,
    names: &[String],
) -> Result<CapsuleImportReport> {
    let toc = inspect(path)?;
    let selected = select_segments(&toc, names)?;
    extract_segments(path, target, &selected)
}

struct GenerationWrite {
    toc: CapsuleToc,
    changed_segment_count: usize,
    reused_segment_count: usize,
    removed_segment_count: usize,
    compressed_segment_count: usize,
    appended_bytes: u64,
}

fn validate_source(source: &Path) -> Result<()> {
    if !source.is_dir() {
        anyhow::bail!("Aura source directory does not exist: {}", source.display());
    }
    Ok(())
}

fn write_v2_header(writer: &mut File, created_at: u64) -> Result<()> {
    writer.seek(SeekFrom::Start(0))?;
    writer.write_all(MAGIC)?;
    writer.write_all(&VERSION.to_le_bytes())?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&created_at.to_le_bytes())?;
    writer.write_all(&[0u8; (HEADER_SIZE as usize) - 16])?;
    Ok(())
}

fn append_generation(
    writer: &mut File,
    files: &[(String, PathBuf)],
    previous: Option<&CapsuleToc>,
    generation: u64,
    signing_key: Option<&SigningKey>,
) -> Result<GenerationWrite> {
    if files.is_empty() || files.len() > MAX_SEGMENTS {
        anyhow::bail!("Invalid Aura artifact count");
    }
    let previous_by_name: std::collections::HashMap<&str, &CapsuleSegment> = previous
        .map(|toc| {
            toc.segments
                .iter()
                .map(|segment| (segment.name.as_str(), segment))
                .collect()
        })
        .unwrap_or_default();
    let current_names: std::collections::HashSet<&str> =
        files.iter().map(|(name, _)| name.as_str()).collect();
    let removed_segment_count = previous
        .map(|toc| {
            toc.segments
                .iter()
                .filter(|segment| !current_names.contains(segment.name.as_str()))
                .count()
        })
        .unwrap_or(0);

    let frame_start = writer.stream_position()?;
    writer.write_all(&[0u8; FRAME_HEADER_SIZE as usize])?;
    let mut segments = Vec::with_capacity(files.len());
    let mut total_original = 0u64;
    let mut total_stored = 0u64;
    let mut changed_segment_count = 0usize;
    let mut reused_segment_count = 0usize;
    let mut compressed_segment_count = 0usize;

    for (name, path) in files {
        let bytes = fs::read(path)
            .with_context(|| format!("failed to read Aura artifact {}", path.display()))?;
        let original_size = bytes.len() as u64;
        if original_size > MAX_SEGMENT_SIZE {
            anyhow::bail!("Artifact exceeds segment size limit: {name}");
        }
        total_original = total_original
            .checked_add(original_size)
            .ok_or_else(|| anyhow!("Aura artifact size overflow"))?;
        if total_original > MAX_TOTAL_SIZE {
            anyhow::bail!("Aura container exceeds total size limit");
        }
        let digest = sha256_hex(&bytes);

        let segment = if let Some(existing) = previous_by_name
            .get(name.as_str())
            .filter(|item| item.original_size == original_size && item.sha256 == digest)
        {
            reused_segment_count += 1;
            (*existing).clone()
        } else {
            let compressed = zstd::stream::encode_all(bytes.as_slice(), 3)?;
            let (codec, payload) = if compressed.len() + 32 < bytes.len() {
                compressed_segment_count += 1;
                (CapsuleCodec::Zstd, compressed)
            } else {
                (CapsuleCodec::Raw, bytes)
            };
            let offset = writer.stream_position()?;
            writer.write_all(&payload)?;
            changed_segment_count += 1;
            CapsuleSegment {
                name: name.clone(),
                offset,
                stored_size: payload.len() as u64,
                original_size,
                codec,
                sha256: digest,
            }
        };
        total_stored = total_stored
            .checked_add(segment.stored_size)
            .ok_or_else(|| anyhow!("Aura container stored size overflow"))?;
        segments.push(segment);
    }

    let starts_signed_epoch =
        signing_key.is_some() && previous.is_some_and(|toc| toc.authenticity.is_none());
    if changed_segment_count == 0 && removed_segment_count == 0 && !starts_signed_epoch {
        writer.set_len(frame_start)?;
        writer.seek(SeekFrom::Start(frame_start))?;
        writer.flush()?;
        writer.sync_all()?;
        let toc = previous
            .cloned()
            .ok_or_else(|| anyhow!("Initial Aura container generation cannot be empty"))?;
        return Ok(GenerationWrite {
            toc,
            changed_segment_count,
            reused_segment_count,
            removed_segment_count,
            compressed_segment_count,
            appended_bytes: 0,
        });
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut toc = CapsuleToc {
        format: "aura-portable-container".into(),
        version: VERSION,
        generation,
        created_at,
        segments,
        original_size: total_original,
        stored_size: total_stored,
        holds: previous.map(|toc| toc.holds.clone()).unwrap_or_default(),
        authenticity: None,
    };
    if let Some(signing_key) = signing_key {
        let previous_manifest = previous
            .and_then(|toc| toc.authenticity.as_ref())
            .map(|authenticity| authenticity.manifest_sha256.as_str());
        sign_toc(&mut toc, previous_manifest, signing_key)?;
    }
    let toc_bytes = serde_json::to_vec(&toc)?;
    if toc_bytes.is_empty() || toc_bytes.len() as u64 > MAX_TOC_SIZE {
        anyhow::bail!("Aura container TOC exceeds size limit");
    }
    let toc_offset = writer.stream_position()?;
    writer.write_all(&toc_bytes)?;
    writer.flush()?;
    writer.sync_all()?;
    let frame_end = writer.stream_position()?;
    let frame_size = frame_end
        .checked_sub(frame_start)
        .ok_or_else(|| anyhow!("Aura generation frame size underflow"))?;
    let toc_offset_relative = toc_offset - frame_start;

    writer.seek(SeekFrom::Start(frame_start))?;
    write_frame_header(
        writer,
        generation,
        created_at,
        frame_size,
        toc_offset_relative,
        toc_bytes.len() as u64,
        &Sha256::digest(&toc_bytes),
    )?;
    writer.flush()?;
    writer.sync_all()?;
    writer.seek(SeekFrom::Start(frame_end))?;

    Ok(GenerationWrite {
        toc,
        changed_segment_count,
        reused_segment_count,
        removed_segment_count,
        compressed_segment_count,
        appended_bytes: frame_size,
    })
}

fn write_control_generation(
    writer: &mut File,
    previous: &CapsuleToc,
    generation: u64,
    holds: Vec<CapsuleGenerationHold>,
    signing_key: Option<&SigningKey>,
) -> Result<()> {
    let frame_start = writer.stream_position()?;
    writer.write_all(&[0u8; FRAME_HEADER_SIZE as usize])?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut toc = CapsuleToc {
        format: previous.format.clone(),
        version: VERSION,
        generation,
        created_at,
        segments: previous.segments.clone(),
        original_size: previous.original_size,
        stored_size: previous.stored_size,
        holds,
        authenticity: None,
    };
    if let Some(signing_key) = signing_key {
        let previous_manifest = previous
            .authenticity
            .as_ref()
            .map(|authenticity| authenticity.manifest_sha256.as_str());
        sign_toc(&mut toc, previous_manifest, signing_key)?;
    }
    let toc_bytes = serde_json::to_vec(&toc)?;
    if toc_bytes.is_empty() || toc_bytes.len() as u64 > MAX_TOC_SIZE {
        anyhow::bail!("Aura control generation TOC exceeds size limit");
    }
    let toc_offset = writer.stream_position()?;
    writer.write_all(&toc_bytes)?;
    writer.flush()?;
    writer.sync_all()?;
    let frame_end = writer.stream_position()?;
    writer.seek(SeekFrom::Start(frame_start))?;
    write_frame_header(
        writer,
        generation,
        created_at,
        frame_end - frame_start,
        toc_offset - frame_start,
        toc_bytes.len() as u64,
        &Sha256::digest(&toc_bytes),
    )?;
    writer.flush()?;
    writer.sync_all()?;
    writer.seek(SeekFrom::Start(frame_end))?;
    Ok(())
}

fn copy_generation_frame(
    source: &mut File,
    output: &mut File,
    original: &CapsuleToc,
    previous: Option<&CapsuleToc>,
) -> Result<(CapsuleToc, usize, usize)> {
    let previous_by_name: std::collections::HashMap<&str, &CapsuleSegment> = previous
        .map(|toc| {
            toc.segments
                .iter()
                .map(|segment| (segment.name.as_str(), segment))
                .collect()
        })
        .unwrap_or_default();
    let frame_start = output.stream_position()?;
    output.write_all(&[0u8; FRAME_HEADER_SIZE as usize])?;
    let mut segments = Vec::with_capacity(original.segments.len());
    let mut copied = 0usize;
    let mut reused = 0usize;
    let mut total_original = 0u64;
    let mut total_stored = 0u64;

    for segment in &original.segments {
        let compacted = if let Some(existing) =
            previous_by_name
                .get(segment.name.as_str())
                .filter(|candidate| {
                    candidate.original_size == segment.original_size
                        && candidate.sha256 == segment.sha256
                }) {
            reused += 1;
            (*existing).clone()
        } else {
            let stored = read_stored_verified(source, segment)?;
            let offset = output.stream_position()?;
            output.write_all(&stored)?;
            copied += 1;
            CapsuleSegment {
                name: segment.name.clone(),
                offset,
                stored_size: segment.stored_size,
                original_size: segment.original_size,
                codec: segment.codec,
                sha256: segment.sha256.clone(),
            }
        };
        total_original = total_original
            .checked_add(compacted.original_size)
            .ok_or_else(|| anyhow!("Compacted Aura original size overflow"))?;
        total_stored = total_stored
            .checked_add(compacted.stored_size)
            .ok_or_else(|| anyhow!("Compacted Aura stored size overflow"))?;
        segments.push(compacted);
    }

    let compacted = CapsuleToc {
        format: original.format.clone(),
        version: VERSION,
        generation: original.generation,
        created_at: original.created_at,
        segments,
        original_size: total_original,
        stored_size: total_stored,
        holds: original.holds.clone(),
        authenticity: original.authenticity.clone(),
    };
    let toc_bytes = serde_json::to_vec(&compacted)?;
    if toc_bytes.is_empty() || toc_bytes.len() as u64 > MAX_TOC_SIZE {
        anyhow::bail!("Compacted Aura container TOC exceeds size limit");
    }
    let toc_offset = output.stream_position()?;
    output.write_all(&toc_bytes)?;
    output.flush()?;
    output.sync_all()?;
    let frame_end = output.stream_position()?;
    let frame_size = frame_end - frame_start;
    output.seek(SeekFrom::Start(frame_start))?;
    write_frame_header(
        output,
        compacted.generation,
        compacted.created_at,
        frame_size,
        toc_offset - frame_start,
        toc_bytes.len() as u64,
        &Sha256::digest(&toc_bytes),
    )?;
    output.flush()?;
    output.sync_all()?;
    output.seek(SeekFrom::Start(frame_end))?;
    Ok((compacted, copied, reused))
}

fn verify_generation_set(path: &Path, generations: &[CapsuleToc]) -> Result<()> {
    let mut file = File::open(path)?;
    let mut verified = std::collections::HashSet::new();
    for toc in generations {
        for segment in &toc.segments {
            let key = (segment.offset, segment.stored_size, segment.sha256.clone());
            if verified.insert(key) {
                let bytes = read_segment(&mut file, segment)?;
                if sha256_hex(&bytes) != segment.sha256 {
                    anyhow::bail!("Checksum mismatch for segment {}", segment.name);
                }
            }
        }
    }
    Ok(())
}

fn estimate_compacted_size(generations: &[CapsuleToc]) -> Result<u64> {
    if generations.is_empty() {
        anyhow::bail!("Cannot estimate an empty Aura generation set");
    }
    let mut size = HEADER_SIZE;
    let mut previous: std::collections::HashMap<&str, (&str, u64)> =
        std::collections::HashMap::new();
    for toc in generations {
        size = size
            .checked_add(FRAME_HEADER_SIZE)
            .ok_or_else(|| anyhow!("Aura compaction estimate overflow"))?;
        for segment in &toc.segments {
            let unchanged =
                previous
                    .get(segment.name.as_str())
                    .is_some_and(|(sha256, original_size)| {
                        *sha256 == segment.sha256 && *original_size == segment.original_size
                    });
            if !unchanged {
                size = size
                    .checked_add(segment.stored_size)
                    .ok_or_else(|| anyhow!("Aura compaction estimate overflow"))?;
            }
        }
        size = size
            .checked_add(serde_json::to_vec(toc)?.len() as u64)
            .ok_or_else(|| anyhow!("Aura compaction estimate overflow"))?;
        previous = toc
            .segments
            .iter()
            .map(|segment| {
                (
                    segment.name.as_str(),
                    (segment.sha256.as_str(), segment.original_size),
                )
            })
            .collect();
    }
    Ok(size)
}

#[cfg(not(windows))]
fn replace_compacted_file(replacement: &Path, destination: &Path) -> Result<()> {
    fs::rename(replacement, destination)?;
    Ok(())
}

#[cfg(not(windows))]
fn replace_checkpoint_file(replacement: &Path, destination: &Path) -> Result<()> {
    fs::rename(replacement, destination)?;
    Ok(())
}

#[cfg(windows)]
fn compaction_backup_path(path: &Path) -> PathBuf {
    path.with_extension("aura.compact.bak")
}

#[cfg(windows)]
fn replace_compacted_file(replacement: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut core::ffi::c_void,
            reserved: *mut core::ffi::c_void,
        ) -> i32;
    }

    let backup = compaction_backup_path(destination);
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replacement_wide: Vec<u16> = replacement
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let backup_wide: Vec<u16> = backup
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            replacement_wide.as_ptr(),
            backup_wide.as_ptr(),
            0x0000_0001,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error()).context(format!(
            "failed to replace Aura container {}; original remains available",
            destination.display()
        ));
    }
    if let Err(error) = verify(destination) {
        anyhow::bail!(
            "Compacted Aura container failed post-replacement verification: {error}; backup retained at {}",
            backup.display()
        );
    }
    if let Err(error) = fs::remove_file(&backup) {
        tracing::warn!(
            path = %backup.display(),
            %error,
            "Aura compaction succeeded but its recovery backup could not be removed"
        );
    }
    Ok(())
}

#[cfg(windows)]
fn replace_checkpoint_file(replacement: &Path, destination: &Path) -> Result<()> {
    if !destination.exists() {
        fs::rename(replacement, destination)?;
        return Ok(());
    }

    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut core::ffi::c_void,
            reserved: *mut core::ffi::c_void,
        ) -> i32;
    }

    let backup = destination.with_extension("aura-checkpoint.bak");
    if backup.exists() {
        anyhow::bail!(
            "Aura checkpoint backup path already exists: {}",
            backup.display()
        );
    }
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replacement_wide: Vec<u16> = replacement
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let backup_wide: Vec<u16> = backup
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            replacement_wide.as_ptr(),
            backup_wide.as_ptr(),
            0x0000_0001,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error()).context(format!(
            "failed to replace Aura authenticity checkpoint {}; previous checkpoint remains available",
            destination.display()
        ));
    }
    read_authenticity_checkpoint(destination)?;
    if let Err(error) = fs::remove_file(&backup) {
        tracing::warn!(
            path = %backup.display(),
            %error,
            "Aura checkpoint updated but its recovery backup could not be removed"
        );
    }
    Ok(())
}

fn write_frame_header(
    writer: &mut File,
    generation: u64,
    created_at: u64,
    frame_size: u64,
    toc_offset_relative: u64,
    toc_size: u64,
    toc_checksum: &[u8],
) -> Result<()> {
    writer.write_all(FRAME_MAGIC)?;
    writer.write_all(&FRAME_VERSION.to_le_bytes())?;
    writer.write_all(&0u16.to_le_bytes())?;
    writer.write_all(&generation.to_le_bytes())?;
    writer.write_all(&created_at.to_le_bytes())?;
    writer.write_all(&frame_size.to_le_bytes())?;
    writer.write_all(&toc_offset_relative.to_le_bytes())?;
    writer.write_all(&toc_size.to_le_bytes())?;
    writer.write_all(toc_checksum)?;
    Ok(())
}

struct LegacyHeader {
    created_at: u64,
    toc_offset: u64,
    toc_size: u64,
    toc_checksum: [u8; 32],
}

fn read_container_version(reader: &mut File) -> Result<u16> {
    if reader.metadata()?.len() < HEADER_SIZE {
        anyhow::bail!("Aura container is shorter than its header");
    }
    reader.seek(SeekFrom::Start(0))?;
    let mut magic = [0u8; 4];
    reader.read_exact(&mut magic)?;
    if &magic != MAGIC {
        anyhow::bail!("Invalid Aura container magic");
    }
    read_u16(reader)
}

fn read_v1_header(reader: &mut File) -> Result<LegacyHeader> {
    let version = read_container_version(reader)?;
    if version != LEGACY_VERSION {
        anyhow::bail!("Not a v1 Aura container");
    }
    let flags = read_u16(reader)?;
    if flags != 0 {
        anyhow::bail!("Unsupported Aura container flags: {flags}");
    }
    let created_at = read_u64(reader)?;
    let toc_offset = read_u64(reader)?;
    let toc_size = read_u64(reader)?;
    let mut toc_checksum = [0u8; 32];
    reader.read_exact(&mut toc_checksum)?;
    Ok(LegacyHeader {
        created_at,
        toc_offset,
        toc_size,
        toc_checksum,
    })
}

fn validate_v1_toc_range(offset: u64, size: u64, file_size: u64) -> Result<()> {
    if size == 0 || size > MAX_TOC_SIZE || offset < HEADER_SIZE {
        anyhow::bail!("Invalid Aura container TOC bounds");
    }
    if offset.checked_add(size) != Some(file_size) {
        anyhow::bail!("Aura container TOC does not terminate at end of file");
    }
    Ok(())
}

struct V2State {
    toc: CapsuleToc,
    generations: Vec<CapsuleToc>,
    committed_end: u64,
}

fn inspect_v2_state(path: &Path) -> Result<V2State> {
    let mut file = File::open(path)?;
    let version = read_container_version(&mut file)?;
    if version != VERSION {
        anyhow::bail!("Incremental append requires an Aura v2 container; found version {version}");
    }
    scan_v2(&mut file)
}

fn scan_v2(file: &mut File) -> Result<V2State> {
    let version = read_container_version(file)?;
    if version != VERSION {
        anyhow::bail!("Not a v2 Aura container");
    }
    let flags = read_u16(file)?;
    if flags != 0 {
        anyhow::bail!("Unsupported Aura container flags: {flags}");
    }
    let file_size = file.metadata()?.len();
    let mut offset = HEADER_SIZE;
    let mut previous_generation = None;
    let mut generations: Vec<CapsuleToc> = Vec::new();
    let mut previous_authenticity: Option<CapsuleGenerationAuthenticity> = None;

    while file_size.saturating_sub(offset) >= FRAME_HEADER_SIZE {
        file.seek(SeekFrom::Start(offset))?;
        let mut header = [0u8; FRAME_HEADER_SIZE as usize];
        file.read_exact(&mut header)?;
        if &header[0..4] != FRAME_MAGIC {
            break;
        }
        let frame_version = u16::from_le_bytes(header[4..6].try_into()?);
        let frame_flags = u16::from_le_bytes(header[6..8].try_into()?);
        let generation = u64::from_le_bytes(header[8..16].try_into()?);
        let created_at = u64::from_le_bytes(header[16..24].try_into()?);
        let frame_size = u64::from_le_bytes(header[24..32].try_into()?);
        let toc_relative = u64::from_le_bytes(header[32..40].try_into()?);
        let toc_size = u64::from_le_bytes(header[40..48].try_into()?);
        let toc_checksum: [u8; 32] = header[48..80].try_into()?;

        let generation_is_valid = previous_generation
            .map(|previous: u64| previous.checked_add(1) == Some(generation))
            .unwrap_or(generation > 0);
        if frame_version != FRAME_VERSION
            || frame_flags != 0
            || !generation_is_valid
            || frame_size < FRAME_HEADER_SIZE
            || frame_size > MAX_TOTAL_SIZE + MAX_TOC_SIZE + FRAME_HEADER_SIZE
            || toc_size == 0
            || toc_size > MAX_TOC_SIZE
            || toc_relative < FRAME_HEADER_SIZE
            || toc_relative.checked_add(toc_size) != Some(frame_size)
        {
            break;
        }
        let Some(frame_end) = offset.checked_add(frame_size) else {
            break;
        };
        if frame_end > file_size {
            break;
        }
        let toc_offset = offset + toc_relative;
        file.seek(SeekFrom::Start(toc_offset))?;
        let mut toc_bytes = vec![0u8; toc_size as usize];
        file.read_exact(&mut toc_bytes)?;
        if Sha256::digest(&toc_bytes).as_slice() != toc_checksum {
            break;
        }
        let toc: CapsuleToc = match serde_json::from_slice(&toc_bytes) {
            Ok(toc) => toc,
            Err(_) => break,
        };
        if toc.generation != generation
            || toc.created_at != created_at
            || validate_toc(&toc, toc_offset, VERSION).is_err()
            || toc.holds.iter().any(|hold| {
                hold.generation != generation
                    && hold.generation
                        >= generations
                            .first()
                            .map(|retained| retained.generation)
                            .unwrap_or(generation)
                    && !generations
                        .iter()
                        .any(|retained| retained.generation == hold.generation)
            })
        {
            break;
        }
        let authenticity = verify_toc_authenticity(&toc)?;
        match (previous_authenticity.as_ref(), authenticity) {
            (Some(previous), Some(current)) => {
                if current.previous_manifest_sha256.as_deref()
                    != Some(previous.manifest_sha256.as_str())
                {
                    anyhow::bail!(
                        "Aura generation {} signature chain predecessor mismatch",
                        toc.generation
                    );
                }
                if current.public_key != previous.public_key {
                    anyhow::bail!(
                        "Aura generation {} changes signing identity inside one chain",
                        toc.generation
                    );
                }
            }
            (Some(_), None) => {
                anyhow::bail!(
                    "Aura generation {} is unsigned after a signed generation",
                    toc.generation
                );
            }
            (None, Some(current)) if !generations.is_empty() => {
                if current.previous_manifest_sha256.is_some() {
                    anyhow::bail!(
                        "Aura generation {} starts a signature epoch with an unexpected predecessor",
                        toc.generation
                    );
                }
            }
            _ => {}
        }
        previous_authenticity = authenticity.cloned();
        previous_generation = Some(generation);
        generations.push(toc);
        offset = frame_end;
    }

    let toc = generations
        .last()
        .cloned()
        .ok_or_else(|| anyhow!("Aura v2 container has no committed generation"))?;
    Ok(V2State {
        toc,
        generations,
        committed_end: offset,
    })
}

fn select_segments(toc: &CapsuleToc, names: &[String]) -> Result<Vec<CapsuleSegment>> {
    if names.is_empty() {
        anyhow::bail!("At least one Aura container segment must be selected");
    }
    let mut requested = names.to_vec();
    requested.sort();
    requested.dedup();
    let by_name: std::collections::HashMap<&str, &CapsuleSegment> = toc
        .segments
        .iter()
        .map(|segment| (segment.name.as_str(), segment))
        .collect();
    let mut selected = Vec::with_capacity(requested.len());
    for name in requested {
        safe_relative_path(&name)?;
        let segment = by_name
            .get(name.as_str())
            .ok_or_else(|| anyhow!("Aura container segment not found: {name}"))?;
        selected.push((*segment).clone());
    }
    Ok(selected)
}

fn extract_segments(
    path: &Path,
    target: &Path,
    segments: &[CapsuleSegment],
) -> Result<CapsuleImportReport> {
    if target.exists() {
        anyhow::bail!(
            "Import target must not exist; refusing to overwrite {}",
            target.display()
        );
    }
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("Import target must have a parent directory"))?;
    fs::create_dir_all(parent)?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| anyhow!("Invalid import target name"))?;
    let staging = parent.join(format!(".{name}.aura-import-{}", std::process::id()));
    if staging.exists() {
        anyhow::bail!("Import staging path already exists: {}", staging.display());
    }

    let result = (|| -> Result<CapsuleImportReport> {
        fs::create_dir(&staging)?;
        let mut file = File::open(path)?;
        let mut restored_size = 0u64;
        for segment in segments {
            let relative = safe_relative_path(&segment.name)?;
            let destination = staging.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            let bytes = read_segment(&mut file, segment)?;
            if sha256_hex(&bytes) != segment.sha256 {
                anyhow::bail!("Checksum mismatch for segment {}", segment.name);
            }
            let temporary = destination.with_extension("import.tmp");
            {
                let mut output = File::create(&temporary)?;
                output.write_all(&bytes)?;
                output.sync_all()?;
            }
            fs::rename(temporary, &destination)?;
            restored_size += bytes.len() as u64;
        }
        fs::rename(&staging, target)?;
        Ok(CapsuleImportReport {
            target_path: target.to_path_buf(),
            segment_count: segments.len(),
            restored_size,
        })
    })();

    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn validate_toc(toc: &CapsuleToc, toc_offset: u64, expected_version: u16) -> Result<()> {
    if toc.format != "aura-portable-container" || toc.version != expected_version {
        anyhow::bail!("Invalid Aura container TOC identity");
    }
    if (expected_version == LEGACY_VERSION && toc.generation != 0)
        || (expected_version == VERSION && toc.generation == 0)
    {
        anyhow::bail!("Invalid Aura container generation");
    }
    if toc.holds.len() > MAX_SEGMENTS {
        anyhow::bail!("Aura container has too many generation holds");
    }
    let mut held = std::collections::HashSet::new();
    for hold in &toc.holds {
        if hold.generation == 0
            || hold.generation > toc.generation
            || !held.insert(hold.generation)
            || hold.label.is_empty()
            || hold.label.len() > 256
            || hold.label.chars().any(|character| character.is_control())
        {
            anyhow::bail!("Aura container has invalid generation hold metadata");
        }
    }
    if toc.segments.is_empty() || toc.segments.len() > MAX_SEGMENTS {
        anyhow::bail!("Invalid Aura container segment count");
    }
    let mut names = std::collections::HashSet::new();
    let mut ranges = Vec::new();
    let mut total_original = 0u64;
    let mut total_stored = 0u64;
    for segment in &toc.segments {
        safe_relative_path(&segment.name)?;
        if !names.insert(segment.name.as_str()) {
            anyhow::bail!("Duplicate Aura container segment: {}", segment.name);
        }
        if segment.original_size > MAX_SEGMENT_SIZE || segment.stored_size > MAX_SEGMENT_SIZE {
            anyhow::bail!("Aura container segment exceeds size limit");
        }
        if matches!(segment.codec, CapsuleCodec::Raw)
            && segment.stored_size != segment.original_size
        {
            anyhow::bail!("Raw Aura container segment has inconsistent size");
        }
        if segment.sha256.len() != 64
            || !segment.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            anyhow::bail!("Aura container segment has invalid SHA-256 digest");
        }
        let end = segment
            .offset
            .checked_add(segment.stored_size)
            .ok_or_else(|| anyhow!("Aura container segment range overflow"))?;
        if segment.offset < HEADER_SIZE || end > toc_offset {
            anyhow::bail!("Aura container segment has invalid bounds");
        }
        total_original = total_original
            .checked_add(segment.original_size)
            .ok_or_else(|| anyhow!("Aura container size overflow"))?;
        total_stored = total_stored
            .checked_add(segment.stored_size)
            .ok_or_else(|| anyhow!("Aura container stored size overflow"))?;
        ranges.push((segment.offset, end));
    }
    if total_original != toc.original_size || total_original > MAX_TOTAL_SIZE {
        anyhow::bail!("Aura container original size mismatch");
    }
    if total_stored != toc.stored_size || total_stored > MAX_TOTAL_SIZE {
        anyhow::bail!("Aura container stored size mismatch");
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        anyhow::bail!("Aura container segments overlap");
    }
    Ok(())
}

fn read_segment(file: &mut File, segment: &CapsuleSegment) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(segment.offset))?;
    let mut stored = vec![0u8; segment.stored_size as usize];
    file.read_exact(&mut stored)?;
    decode_segment(&stored, segment)
}

fn read_stored_verified(file: &mut File, segment: &CapsuleSegment) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(segment.offset))?;
    let mut stored = vec![0u8; segment.stored_size as usize];
    file.read_exact(&mut stored)?;
    let bytes = decode_segment(&stored, segment)?;
    if sha256_hex(&bytes) != segment.sha256 {
        anyhow::bail!("Checksum mismatch for segment {}", segment.name);
    }
    Ok(stored)
}

fn decode_segment(stored: &[u8], segment: &CapsuleSegment) -> Result<Vec<u8>> {
    let bytes = match segment.codec {
        CapsuleCodec::Raw => stored.to_vec(),
        CapsuleCodec::Zstd => {
            let decoder = zstd::stream::read::Decoder::new(stored)?;
            let mut limited = decoder.take(segment.original_size + 1);
            let mut decoded = Vec::with_capacity(segment.original_size as usize);
            limited.read_to_end(&mut decoded)?;
            decoded
        }
    };
    if bytes.len() as u64 != segment.original_size {
        anyhow::bail!("Decoded size mismatch for segment {}", segment.name);
    }
    Ok(bytes)
}

fn collect_artifacts(root: &Path) -> Result<Vec<(String, PathBuf)>> {
    const ROOT_FILES: &[&str] = &[
        "brain.aura",
        "temporal.bin",
        "brain.cog",
        "brain.snap",
        "beliefs.cog",
        "concepts.cog",
        "causal.cog",
        "topology.cog",
        "policies.cog",
        "persistence_manifest.json",
        "maintenance_trends.json",
        "reflection_summaries.json",
        "recall_replay.json",
        "brain.audit",
        ".aura.learned",
        "canonical.aura.syn",
    ];
    let mut files = Vec::new();
    for name in ROOT_FILES {
        let path = root.join(name);
        if path.is_file() {
            files.push(((*name).to_string(), path));
        }
    }
    for directory in ["index", "versions"] {
        let path = root.join(directory);
        if path.is_dir() {
            collect_directory(root, &path, &mut files)?;
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn collect_directory(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_directory(root, &entry.path(), files)?;
        } else if file_type.is_file() {
            let relative = entry.path().strip_prefix(root)?.to_path_buf();
            let name = path_to_portable_name(&relative)?;
            files.push((name, entry.path()));
        }
    }
    Ok(())
}

fn path_to_portable_name(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => parts.push(
                value
                    .to_str()
                    .ok_or_else(|| anyhow!("Aura artifact path is not UTF-8"))?,
            ),
            _ => anyhow::bail!("Aura artifact path is not relative"),
        }
    }
    Ok(parts.join("/"))
}

fn safe_relative_path(name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.len() > 512 || name.contains('\\') {
        anyhow::bail!("Unsafe Aura container segment name");
    }
    let path = Path::new(name);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        anyhow::bail!("Unsafe Aura container segment path: {name}");
    }
    Ok(path.to_path_buf())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_u16(reader: &mut File) -> Result<u16> {
    let mut bytes = [0u8; 2];
    reader.read_exact(&mut bytes)?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u64(reader: &mut File) -> Result<u64> {
    let mut bytes = [0u8; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_corruption_detection() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), vec![0u8; 4096])?;
        fs::write(
            source.path().join("brain.cog"),
            b"important cognitive state",
        )?;
        fs::create_dir(source.path().join("index"))?;
        fs::write(source.path().join("index/sdr.idx"), b"index bytes")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");

        let report = export_directory(source.path(), &container)?;
        assert_eq!(report.segment_count, 3);
        assert_eq!(report.generation, 1);
        assert!(report.compressed_segment_count >= 1);
        assert_eq!(verify(&container)?.segments.len(), 3);

        let imported = output_dir.path().join("imported");
        let import_report = import_to_new_directory(&container, &imported)?;
        assert_eq!(import_report.segment_count, 3);
        assert_eq!(
            fs::read(imported.join("brain.cog"))?,
            b"important cognitive state"
        );

        let toc = inspect(&container)?;
        let first_offset = toc.segments[0].offset;
        let mut file = fs::OpenOptions::new().write(true).open(&container)?;
        file.seek(SeekFrom::Start(first_offset))?;
        file.write_all(&[0xFF])?;
        file.sync_all()?;
        assert!(verify(&container).is_err());
        Ok(())
    }

    #[test]
    fn import_refuses_existing_target() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), b"state")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        let existing = output_dir.path().join("existing");
        fs::create_dir(&existing)?;
        assert!(import_to_new_directory(&container, &existing).is_err());
        Ok(())
    }

    #[test]
    fn append_reuses_unchanged_segments_and_supports_partial_extraction() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), vec![7u8; 4096])?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        let first = inspect(&container)?;
        let stable_offset = first
            .segments
            .iter()
            .find(|segment| segment.name == "brain.aura")
            .unwrap()
            .offset;

        fs::write(source.path().join("brain.cog"), b"generation two")?;
        let appended = append_directory(source.path(), &container)?;
        assert_eq!(appended.generation, 2);
        assert_eq!(appended.changed_segment_count, 1);
        assert_eq!(appended.reused_segment_count, 1);
        let second = inspect(&container)?;
        assert_eq!(second.generation, 2);
        assert_eq!(
            second
                .segments
                .iter()
                .find(|segment| segment.name == "brain.aura")
                .unwrap()
                .offset,
            stable_offset
        );
        assert_eq!(
            read_named_segment(&container, "brain.cog")?,
            b"generation two"
        );

        let selected = verify_selected(&container, &["brain.cog".into()])?;
        assert_eq!(selected.segments, vec!["brain.cog"]);
        let partial = output_dir.path().join("partial");
        let extracted =
            extract_selected_to_new_directory(&container, &partial, &["brain.cog".into()])?;
        assert_eq!(extracted.segment_count, 1);
        assert_eq!(fs::read(partial.join("brain.cog"))?, b"generation two");
        assert!(!partial.join("brain.aura").exists());

        let no_op = append_directory(source.path(), &container)?;
        assert_eq!(no_op.generation, 2);
        assert_eq!(no_op.appended_bytes, 0);
        assert_eq!(no_op.reused_segment_count, 2);
        Ok(())
    }

    #[test]
    fn append_recovers_from_an_uncommitted_tail_and_records_removals() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), b"stable")?;
        fs::write(source.path().join("brain.cog"), b"remove me")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        let committed_size = fs::metadata(&container)?.len();

        let mut file = fs::OpenOptions::new().append(true).open(&container)?;
        file.write_all(&[0u8; 256])?;
        file.sync_all()?;
        assert_eq!(inspect(&container)?.generation, 1);

        fs::remove_file(source.path().join("brain.cog"))?;
        let appended = append_directory(source.path(), &container)?;
        assert_eq!(appended.generation, 2);
        assert_eq!(appended.removed_segment_count, 1);
        assert_eq!(appended.changed_segment_count, 0);
        assert!(appended.container_size < committed_size + 256 + appended.appended_bytes);
        let toc = verify(&container)?;
        assert_eq!(toc.segments.len(), 1);
        assert_eq!(toc.segments[0].name, "brain.aura");
        Ok(())
    }

    #[test]
    fn legacy_v1_container_remains_readable() -> Result<()> {
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("legacy.aura");
        let payload = b"legacy state";
        let created_at = 1234u64;
        let segment = CapsuleSegment {
            name: "brain.aura".into(),
            offset: HEADER_SIZE,
            stored_size: payload.len() as u64,
            original_size: payload.len() as u64,
            codec: CapsuleCodec::Raw,
            sha256: sha256_hex(payload),
        };
        let toc = CapsuleToc {
            format: "aura-portable-container".into(),
            version: LEGACY_VERSION,
            generation: 0,
            created_at,
            segments: vec![segment],
            original_size: payload.len() as u64,
            stored_size: payload.len() as u64,
            holds: Vec::new(),
            authenticity: None,
        };
        let toc_bytes = serde_json::to_vec(&toc)?;
        let toc_offset = HEADER_SIZE + payload.len() as u64;
        let mut file = File::create(&container)?;
        file.write_all(MAGIC)?;
        file.write_all(&LEGACY_VERSION.to_le_bytes())?;
        file.write_all(&0u16.to_le_bytes())?;
        file.write_all(&created_at.to_le_bytes())?;
        file.write_all(&toc_offset.to_le_bytes())?;
        file.write_all(&(toc_bytes.len() as u64).to_le_bytes())?;
        file.write_all(&Sha256::digest(&toc_bytes))?;
        file.write_all(payload)?;
        file.write_all(&toc_bytes)?;
        file.sync_all()?;

        assert_eq!(inspect(&container)?.version, LEGACY_VERSION);
        assert_eq!(read_named_segment(&container, "brain.aura")?, payload);
        assert!(append_directory(output_dir.path(), &container).is_err());
        assert!(compact_in_place(&container, 1).is_err());
        Ok(())
    }

    #[test]
    fn append_does_not_capture_the_container_when_stored_below_source() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), b"state one")?;
        let container = source.path().join("versions/memory.aura");
        export_directory(source.path(), &container)?;
        fs::write(source.path().join("brain.aura"), b"state two")?;
        append_directory(source.path(), &container)?;
        let toc = verify(&container)?;
        assert_eq!(toc.generation, 2);
        assert!(toc
            .segments
            .iter()
            .all(|segment| segment.name != "versions/memory.aura"));
        Ok(())
    }

    #[test]
    fn compaction_retains_recent_generations_and_allows_future_append() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), vec![3u8; 8192])?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        for value in [
            b"generation two".as_slice(),
            b"generation three".as_slice(),
            b"generation four".as_slice(),
        ] {
            fs::write(source.path().join("brain.cog"), value)?;
            append_directory(source.path(), &container)?;
        }
        assert_eq!(
            list_generations(&container)?
                .iter()
                .map(|item| item.generation)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
        let previous_size = fs::metadata(&container)?.len();

        let report = compact_in_place(&container, 2)?;
        assert_eq!(report.kept_generations, vec![3, 4]);
        assert_eq!(report.dropped_generation_count, 2);
        assert!(report.reclaimed_bytes > 0);
        assert!(report.compacted_size < previous_size);
        assert_eq!(
            list_generations(&container)?
                .iter()
                .map(|item| item.generation)
                .collect::<Vec<_>>(),
            vec![3, 4]
        );
        assert!(inspect_generation(&container, 2).is_err());
        assert_eq!(inspect_generation(&container, 3)?.generation, 3);
        assert_eq!(
            read_named_segment(&container, "brain.cog")?,
            b"generation four"
        );
        verify(&container)?;

        fs::write(source.path().join("brain.cog"), b"generation five")?;
        let appended = append_directory(source.path(), &container)?;
        assert_eq!(appended.generation, 5);
        assert_eq!(
            list_generations(&container)?
                .iter()
                .map(|item| item.generation)
                .collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
        Ok(())
    }

    #[test]
    fn compaction_removes_uncommitted_tail_and_noops_when_already_within_policy() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.aura"), b"stable")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        let committed_size = fs::metadata(&container)?.len();
        let mut file = fs::OpenOptions::new().append(true).open(&container)?;
        file.write_all(&[0xAA; 128])?;
        file.sync_all()?;
        drop(file);

        let cleaned = compact_in_place(&container, 10)?;
        assert_eq!(cleaned.kept_generations, vec![1]);
        assert_eq!(cleaned.trailing_bytes_removed, 128);
        assert_eq!(fs::metadata(&container)?.len(), committed_size);
        let no_op = compact_in_place(&container, 10)?;
        assert_eq!(no_op.reclaimed_bytes, 0);
        assert_eq!(no_op.copied_segment_count, 0);
        Ok(())
    }

    #[test]
    fn compaction_rejects_corrupt_retained_history_without_replacing_original() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;
        fs::write(source.path().join("brain.cog"), b"generation two")?;
        append_directory(source.path(), &container)?;
        fs::write(source.path().join("brain.cog"), b"generation three")?;
        append_directory(source.path(), &container)?;
        let second = inspect_generation(&container, 2)?;
        let offset = second.segments[0].offset;
        let previous_size = fs::metadata(&container)?.len();
        let mut file = fs::OpenOptions::new().write(true).open(&container)?;
        file.seek(SeekFrom::Start(offset))?;
        file.write_all(&[0xFF])?;
        file.sync_all()?;
        drop(file);

        assert!(compact_in_place(&container, 2).is_err());
        assert_eq!(fs::metadata(&container)?.len(), previous_size);
        assert_eq!(
            list_generations(&container)?
                .iter()
                .map(|item| item.generation)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(!container.with_extension("aura.compact.tmp").exists());
        assert!(compact_in_place(&container, 0).is_err());
        Ok(())
    }

    #[test]
    fn historical_restore_and_diff_are_generation_exact() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(
            source.path().join("brain.aura"),
            b"removed in generation two",
        )?;
        fs::write(source.path().join("brain.cog"), b"old cognitive state")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("memory.aura");
        export_directory(source.path(), &container)?;

        fs::remove_file(source.path().join("brain.aura"))?;
        fs::write(source.path().join("brain.cog"), b"new cognitive state")?;
        fs::create_dir(source.path().join("index"))?;
        fs::write(source.path().join("index/sdr.idx"), b"new index")?;
        append_directory(source.path(), &container)?;

        let diff = diff_generations(&container, 1, 2)?;
        assert_eq!(diff.added, vec!["index/sdr.idx"]);
        assert_eq!(diff.removed, vec!["brain.aura"]);
        assert_eq!(diff.changed.len(), 1);
        assert_eq!(diff.changed[0].name, "brain.cog");
        assert!(diff.unchanged.is_empty());
        assert_eq!(
            read_named_segment_at_generation(&container, 1, "brain.cog")?,
            b"old cognitive state"
        );
        assert_eq!(
            read_named_segment_at_generation(&container, 2, "brain.cog")?,
            b"new cognitive state"
        );

        let restored_one = output_dir.path().join("generation-one");
        import_generation_to_new_directory(&container, &restored_one, 1)?;
        assert_eq!(
            fs::read(restored_one.join("brain.cog"))?,
            b"old cognitive state"
        );
        assert!(restored_one.join("brain.aura").exists());
        assert!(!restored_one.join("index/sdr.idx").exists());

        let restored_two = output_dir.path().join("generation-two");
        import_generation_to_new_directory(&container, &restored_two, 2)?;
        assert_eq!(
            fs::read(restored_two.join("brain.cog"))?,
            b"new cognitive state"
        );
        assert!(!restored_two.join("brain.aura").exists());
        assert_eq!(fs::read(restored_two.join("index/sdr.idx"))?, b"new index");
        Ok(())
    }

    #[test]
    fn retention_policy_applies_count_age_and_size_limits() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let count_container = output_dir.path().join("count.aura");
        export_directory(source.path(), &count_container)?;
        for number in 2..=5 {
            fs::write(
                source.path().join("brain.cog"),
                format!("generation {number}"),
            )?;
            append_directory(source.path(), &count_container)?;
        }
        let count_report = apply_retention_policy(
            &count_container,
            &CapsuleRetentionPolicy {
                min_generations: 2,
                max_generations: Some(3),
                max_age_seconds: None,
                max_size_bytes: None,
            },
        )?;
        assert_eq!(count_report.selected_keep_last, 3);
        assert_eq!(count_report.compaction.kept_generations, vec![3, 4, 5]);
        fs::write(source.path().join("brain.cog"), b"generation six")?;
        let managed = append_directory_with_retention(
            source.path(),
            &count_container,
            &CapsuleRetentionPolicy {
                min_generations: 1,
                max_generations: Some(2),
                max_age_seconds: None,
                max_size_bytes: None,
            },
        )?;
        assert_eq!(managed.append.generation, 6);
        assert_eq!(managed.retention.compaction.kept_generations, vec![5, 6]);

        let size_container = output_dir.path().join("size.aura");
        export_directory(source.path(), &size_container)?;
        for number in 6..=8 {
            fs::write(
                source.path().join("brain.cog"),
                vec![number as u8; 1024 + number * 17],
            )?;
            append_directory(source.path(), &size_container)?;
        }
        let size_state = inspect_v2_state(&size_container)?;
        let one_generation_limit =
            estimate_compacted_size(&size_state.generations[size_state.generations.len() - 1..])?;
        let size_report = apply_retention_policy(
            &size_container,
            &CapsuleRetentionPolicy {
                min_generations: 1,
                max_generations: None,
                max_age_seconds: None,
                max_size_bytes: Some(one_generation_limit),
            },
        )?;
        assert_eq!(size_report.selected_keep_last, 1);
        assert!(size_report.size_target_met);
        let impossible_size = apply_retention_policy(
            &size_container,
            &CapsuleRetentionPolicy {
                min_generations: 1,
                max_generations: None,
                max_age_seconds: None,
                max_size_bytes: Some(1),
            },
        )?;
        assert_eq!(impossible_size.selected_keep_last, 1);
        assert!(!impossible_size.size_target_met);

        let age_container = output_dir.path().join("age.aura");
        export_directory(source.path(), &age_container)?;
        let first_created = inspect(&age_container)?.created_at;
        while SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            <= first_created
        {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        fs::write(source.path().join("brain.cog"), b"newest generation")?;
        append_directory(source.path(), &age_container)?;
        let age_report = apply_retention_policy(
            &age_container,
            &CapsuleRetentionPolicy {
                min_generations: 1,
                max_generations: None,
                max_age_seconds: Some(0),
                max_size_bytes: None,
            },
        )?;
        assert_eq!(age_report.selected_keep_last, 1);
        assert_eq!(age_report.compaction.kept_generations.len(), 1);
        assert!(
            apply_retention_policy(&age_container, &CapsuleRetentionPolicy::default()).is_err()
        );
        Ok(())
    }

    #[test]
    fn dry_run_and_legal_hold_protect_history_until_release() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("holds.aura");
        export_directory(source.path(), &container)?;
        for number in 2..=4 {
            fs::write(
                source.path().join("brain.cog"),
                format!("generation {number}"),
            )?;
            append_directory(source.path(), &container)?;
        }

        let held = set_generation_hold(&container, 2, "legal-case-42")?;
        assert_eq!(held.control_generation, 5);
        assert_eq!(held.active_holds.len(), 1);
        let policy = CapsuleRetentionPolicy {
            min_generations: 1,
            max_generations: Some(1),
            max_age_seconds: None,
            max_size_bytes: None,
        };
        let before_plan_size = fs::metadata(&container)?.len();
        let plan = plan_retention_policy(&container, &policy)?;
        assert_eq!(fs::metadata(&container)?.len(), before_plan_size);
        assert_eq!(plan.held_generations, vec![2]);
        assert_eq!(plan.hold_floor_generation, Some(2));
        assert!(plan.limits_blocked_by_holds);
        assert_eq!(plan.drop_generations, vec![1]);
        assert_eq!(plan.keep_generations, vec![2, 3, 4, 5]);

        let compacted = compact_in_place(&container, 1)?;
        assert_eq!(compacted.kept_generations, vec![2, 3, 4, 5]);
        fs::write(source.path().join("brain.cog"), b"generation six")?;
        append_directory(source.path(), &container)?;
        assert_eq!(inspect(&container)?.holds[0].generation, 2);

        let released = release_generation_hold(&container, 2)?;
        assert!(released.active_holds.is_empty());
        assert_eq!(released.control_generation, 7);
        let released_plan = plan_retention_policy(&container, &policy)?;
        assert!(!released_plan.limits_blocked_by_holds);
        assert_eq!(released_plan.keep_generations, vec![7]);
        let applied = apply_retention_policy(&container, &policy)?;
        assert_eq!(applied.compaction.kept_generations, vec![7]);
        Ok(())
    }

    #[test]
    fn background_scheduler_applies_retention_and_stops_promptly() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.cog"), b"generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("scheduled.aura");
        export_directory(source.path(), &container)?;
        for number in 2..=3 {
            fs::write(
                source.path().join("brain.cog"),
                format!("generation {number}"),
            )?;
            append_directory(source.path(), &container)?;
        }
        let policy = CapsuleRetentionPolicy {
            min_generations: 1,
            max_generations: Some(1),
            max_age_seconds: None,
            max_size_bytes: None,
        };
        assert!(CapsuleRetentionScheduler::start(container.clone(), policy.clone(), 0).is_err());
        let mut scheduler = CapsuleRetentionScheduler::start(container.clone(), policy, 1)?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        while std::time::Instant::now() < deadline {
            if scheduler.status().run_count > 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let status = scheduler.status();
        assert!(status.run_count > 0);
        assert!(status.last_error.is_none());
        assert_eq!(list_generations(&container)?.len(), 1);
        scheduler.stop();
        assert!(!scheduler.status().running);
        Ok(())
    }

    #[test]
    fn concurrent_append_and_compaction_are_serialized() -> Result<()> {
        let first_source = tempfile::tempdir()?;
        let second_source = tempfile::tempdir()?;
        fs::write(first_source.path().join("brain.cog"), b"generation one")?;
        fs::write(second_source.path().join("brain.cog"), b"generation two")?;
        let output_dir = tempfile::tempdir()?;
        let container = std::sync::Arc::new(output_dir.path().join("concurrent.aura"));
        export_directory(first_source.path(), &container)?;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));

        let append_path = container.clone();
        let append_barrier = barrier.clone();
        let second_path = second_source.path().to_path_buf();
        let append = std::thread::spawn(move || {
            append_barrier.wait();
            append_directory(&second_path, &append_path)
        });
        let compact_path = container.clone();
        let compact_barrier = barrier.clone();
        let compact = std::thread::spawn(move || {
            compact_barrier.wait();
            compact_in_place(&compact_path, 1)
        });
        barrier.wait();
        append.join().expect("append thread panicked")?;
        compact.join().expect("compaction thread panicked")?;

        assert_eq!(
            read_named_segment(&container, "brain.cog")?,
            b"generation two"
        );
        assert_eq!(inspect(&container)?.generation, 2);
        verify(&container)?;
        Ok(())
    }

    #[test]
    fn signed_generations_chain_across_append_holds_and_compaction() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(source.path().join("brain.cog"), b"signed generation one")?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("signed.aura");
        let key = generate_signing_key();

        export_directory_signed(source.path(), &container, &key.private_key)?;
        let initial = verify_authenticity(&container, Some(&key.public_key), true)?;
        assert_eq!(initial.signed_generation_count, 1);
        assert!(initial.all_generations_signed);
        assert!(!initial.detached_prefix);

        fs::write(source.path().join("brain.cog"), b"signed generation two")?;
        append_directory_signed(source.path(), &container, &key.private_key)?;
        assert_eq!(
            verify_authenticity(&container, Some(&key.public_key), true)?.signed_generation_count,
            2
        );

        fs::write(source.path().join("brain.cog"), b"unsigned downgrade")?;
        assert!(append_directory(source.path(), &container).is_err());
        let wrong_key = generate_signing_key();
        assert!(
            append_directory_signed(source.path(), &container, &wrong_key.private_key).is_err()
        );
        assert!(verify_authenticity(&container, Some(&wrong_key.public_key), true).is_err());
        assert_eq!(inspect(&container)?.generation, 2);

        set_generation_hold_signed(&container, 1, "signed-case", &key.private_key)?;
        release_generation_hold_signed(&container, 1, &key.private_key)?;
        let compacted = compact_in_place(&container, 2)?;
        assert_eq!(compacted.kept_generations, vec![3, 4]);
        let compacted_auth = verify_authenticity(&container, Some(&key.public_key), true)?;
        assert_eq!(compacted_auth.signed_generation_count, 2);
        assert!(compacted_auth.detached_prefix);
        verify(&container)?;
        let rejected_target = output_dir.path().join("wrong-signer");
        assert!(import_authenticated_to_new_directory(
            &container,
            &rejected_target,
            &wrong_key.public_key,
            true,
        )
        .is_err());
        assert!(!rejected_target.exists());
        let restored = output_dir.path().join("trusted-restore");
        import_authenticated_to_new_directory(&container, &restored, &key.public_key, true)?;
        assert_eq!(
            fs::read(restored.join("brain.cog"))?,
            b"signed generation two"
        );
        Ok(())
    }

    #[test]
    fn signed_epoch_can_start_on_existing_container_and_detects_toc_tampering() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(
            source.path().join("brain.cog"),
            b"legacy unsigned generation",
        )?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("transition.aura");
        export_directory(source.path(), &container)?;
        let key = generate_signing_key();

        let attestation = append_directory_signed(source.path(), &container, &key.private_key)?;
        assert_eq!(attestation.generation, 2);
        assert!(attestation.appended_bytes > 0);
        let transition = verify_authenticity(&container, Some(&key.public_key), false)?;
        assert_eq!(transition.unsigned_generation_count, 1);
        assert_eq!(transition.signed_generation_count, 1);
        assert_eq!(transition.chain_start_generation, Some(2));
        assert!(verify_authenticity(&container, Some(&key.public_key), true).is_err());

        let state = inspect_v2_state(&container)?;
        let signature = state
            .toc
            .authenticity
            .as_ref()
            .expect("signed generation")
            .signature
            .clone();
        let mut replacement = signature.clone();
        replacement.replace_range(0..1, if signature.starts_with('0') { "1" } else { "0" });
        let mut file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&container)?;
        let mut latest_frame_start = HEADER_SIZE;
        for _ in 0..state.generations.len() {
            file.seek(SeekFrom::Start(latest_frame_start + 24))?;
            let frame_size = read_u64(&mut file)?;
            if latest_frame_start + frame_size == state.committed_end {
                break;
            }
            latest_frame_start += frame_size;
        }
        file.seek(SeekFrom::Start(latest_frame_start + 32))?;
        let toc_relative = read_u64(&mut file)?;
        let toc_size = read_u64(&mut file)?;
        let toc_offset = latest_frame_start + toc_relative;
        file.seek(SeekFrom::Start(toc_offset))?;
        let mut toc_bytes = vec![0u8; toc_size as usize];
        file.read_exact(&mut toc_bytes)?;
        let toc_text = String::from_utf8(toc_bytes)?;
        let tampered = toc_text.replacen(&signature, &replacement, 1).into_bytes();
        assert_eq!(tampered.len() as u64, toc_size);
        file.seek(SeekFrom::Start(toc_offset))?;
        file.write_all(&tampered)?;
        file.seek(SeekFrom::Start(latest_frame_start + 48))?;
        file.write_all(&Sha256::digest(&tampered))?;
        file.sync_all()?;
        drop(file);

        let error = inspect(&container).expect_err("tampered signature must fail");
        assert!(error.to_string().contains("signature verification failed"));
        Ok(())
    }

    #[test]
    fn authenticity_checkpoint_detects_rollback_fork_and_corruption() -> Result<()> {
        let source = tempfile::tempdir()?;
        fs::write(
            source.path().join("brain.cog"),
            b"checkpoint generation one",
        )?;
        let output_dir = tempfile::tempdir()?;
        let container = output_dir.path().join("checkpointed.aura");
        let generation_one = output_dir.path().join("generation-one.aura");
        let current_backup = output_dir.path().join("generation-two.aura");
        let checkpoint = output_dir.path().join("trusted-checkpoint.json");
        let key = generate_signing_key();

        export_directory_signed(source.path(), &container, &key.private_key)?;
        fs::copy(&container, &generation_one)?;
        let created = update_authenticity_checkpoint(&container, &checkpoint, &key.public_key)?;
        assert_eq!(created.generation, 1);
        assert!(verify_authenticity_checkpoint(&container, &checkpoint)?.checkpoint_is_current);

        fs::write(
            source.path().join("brain.cog"),
            b"checkpoint generation two",
        )?;
        append_directory_signed(source.path(), &container, &key.private_key)?;
        let advanced = verify_authenticity_checkpoint(&container, &checkpoint)?;
        assert_eq!(advanced.advanced_by, 1);
        assert!(!advanced.checkpoint_is_current);
        let updated = update_authenticity_checkpoint(&container, &checkpoint, &key.public_key)?;
        assert_eq!(updated.generation, 2);
        fs::copy(&container, &current_backup)?;

        fs::copy(&generation_one, &container)?;
        let rollback = verify_authenticity_checkpoint(&container, &checkpoint)
            .expect_err("older signed container must be rejected");
        assert!(rollback.to_string().contains("rollback detected"));

        fs::write(source.path().join("brain.cog"), b"forked generation two")?;
        append_directory_signed(source.path(), &container, &key.private_key)?;
        let fork = verify_authenticity_checkpoint(&container, &checkpoint)
            .expect_err("same generation with another digest must be rejected");
        assert!(fork.to_string().contains("fork detected"));

        fs::copy(&current_backup, &container)?;
        fs::write(&checkpoint, b"{not-valid-json")?;
        assert!(verify_authenticity_checkpoint(&container, &checkpoint).is_err());
        Ok(())
    }

    #[test]
    #[ignore]
    fn cross_process_lock_helper() -> Result<()> {
        let container = std::env::var_os("AURA_CAPSULE_LOCK_HELPER_PATH")
            .map(PathBuf::from)
            .ok_or_else(|| anyhow!("missing helper container path"))?;
        let ready = std::env::var_os("AURA_CAPSULE_LOCK_HELPER_READY")
            .map(PathBuf::from)
            .ok_or_else(|| anyhow!("missing helper ready path"))?;
        let _guard = acquire_mutation_lock(&container, Duration::from_secs(5))?;
        fs::write(ready, b"locked")?;
        std::thread::sleep(Duration::from_millis(750));
        Ok(())
    }

    #[test]
    fn mutation_lock_serializes_separate_processes_and_recovers_after_exit() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let container = directory.path().join("process-safe.aura");
        let ready = directory.path().join("lock-ready");
        let mut child = std::process::Command::new(std::env::current_exe()?)
            .arg("--exact")
            .arg("capsule::tests::cross_process_lock_helper")
            .arg("--ignored")
            .arg("--nocapture")
            .env("AURA_CAPSULE_LOCK_HELPER_PATH", &container)
            .env("AURA_CAPSULE_LOCK_HELPER_READY", &ready)
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready.exists() && Instant::now() < deadline {
            if child.try_wait()?.is_some() {
                anyhow::bail!("Aura cross-process lock helper exited before acquiring the lock");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !ready.exists() {
            let _ = child.kill();
            anyhow::bail!("Aura cross-process lock helper did not become ready");
        }

        let error = acquire_mutation_lock(&container, Duration::from_millis(100))
            .err()
            .ok_or_else(|| anyhow!("second process unexpectedly acquired the mutation lock"))?;
        assert!(error.to_string().contains("Timed out"));
        assert!(child.wait()?.success());

        let guard = acquire_mutation_lock(&container, Duration::from_secs(1))?;
        drop(guard);
        assert!(mutation_lock_path(&container)?.exists());
        Ok(())
    }
}
