use aura::cognitive_store::CognitiveStore;
use aura::index::InvertedIndex;
use aura::levels::Level;
use aura::record::Record;
use aura::sdr::SDRInterpreter;
use aura::storage::{AuraStorage, StoredRecord};
use byteorder::{LittleEndian, WriteBytesExt};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

const RECORD_ID_R1: &str = "000000000001";
const RECORD_ID_R2: &str = "000000000002";
const AURA_ID_R1: &str = "aura_r1";
const AURA_ID_R2: &str = "aura_r2";
const FIXED_NOW_UNIX: f64 = 1_700_000_000.0;

fn make_record(id: &str, content: &str, tags: Vec<String>, aura_id: &str) -> Record {
    let mut rec = Record::new(content.to_string(), Level::Working);
    rec.id = id.to_string();
    rec.created_at = FIXED_NOW_UNIX;
    rec.last_activated = FIXED_NOW_UNIX;
    rec.strength = 1.0;
    rec.tags = tags;
    rec.aura_id = Some(aura_id.to_string());
    rec.namespace = "default".to_string();
    rec.source_type = "recorded".to_string();
    rec.semantic_type = "fact".to_string();
    rec.metadata = HashMap::new();
    rec.connections = HashMap::new();
    rec.connection_types = HashMap::new();
    rec
}

fn write_snapshot(out: &PathBuf, records: &[Record]) -> anyhow::Result<()> {
    let log_path = out.join("brain.cog");
    let snap_path = out.join("brain.snap");
    let tmp_path = out.join("brain.snap.tmp");

    let log_pos = log_path.metadata()?.len();

    let file = File::create(&tmp_path)?;
    let mut writer = BufWriter::new(file);
    writer.write_all(b"CSN1")?;
    writer.write_u8(2)?;
    writer.write_u64::<LittleEndian>(log_pos)?;
    writer.write_u32::<LittleEndian>(records.len() as u32)?;
    for rec in records {
        let payload = serde_json::to_vec(rec)?;
        writer.write_u32::<LittleEndian>(payload.len() as u32)?;
        writer.write_all(&payload)?;
    }
    writer.flush()?;

    std::fs::rename(tmp_path, snap_path)?;
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "typescript/test/fixtures/recall_parity".to_string());
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let sdr = SDRInterpreter::default();
    let sdr_r1 = sdr.text_to_sdr("alpha", false);
    let sdr_r2 = sdr.text_to_sdr("alpha zeta", false);

    let storage = AuraStorage::new(&out)?;
    storage.append(&StoredRecord {
        id: AURA_ID_R1.to_string(),
        dna: "user_core".to_string(),
        timestamp: FIXED_NOW_UNIX,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: sdr_r1.clone(),
        text: "alpha".to_string(),
        encrypted_flag: 0,
        offset: 0,
    })?;
    storage.append(&StoredRecord {
        id: AURA_ID_R2.to_string(),
        dna: "user_core".to_string(),
        timestamp: FIXED_NOW_UNIX + 1.0,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: sdr_r2.clone(),
        text: "alpha zeta".to_string(),
        encrypted_flag: 0,
        offset: 0,
    })?;
    storage.flush()?;

    let index_dir = out.join("index");
    std::fs::create_dir_all(&index_dir)?;
    let index = InvertedIndex::new(&index_dir);
    index.add(AURA_ID_R1, &sdr_r1);
    index.add(AURA_ID_R2, &sdr_r2);
    index.save()?;

    let store = CognitiveStore::new(&out)?;
    let r1 = make_record(
        RECORD_ID_R1,
        "alpha",
        vec!["alpha".to_string()],
        AURA_ID_R1,
    );
    let r2 = make_record(
        RECORD_ID_R2,
        "alpha zeta",
        vec!["alpha".to_string(), "x".to_string()],
        AURA_ID_R2,
    );
    store.append_store(&r1)?;
    store.append_store(&r2)?;

    write_snapshot(&out, &[r1, r2])?;

    Ok(())
}
