use aura::storage::{AuraStorage, StoredRecord};
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "typescript/test/fixtures/minimal_brain".to_string());
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let storage = AuraStorage::new(&out)?;
    let record = StoredRecord {
        id: "ts_fixture_1".to_string(),
        dna: "user_core".to_string(),
        timestamp: 123456789.0,
        intensity: 5.5,
        stability: 1.0,
        decay_velocity: 0.1,
        entropy: 0.2,
        sdr_indices: vec![1, 10, 100, 2000],
        text: "Hello TS Fixture".to_string(),
        offset: 0,
    };
    storage.append(&record)?;
    storage.flush()?;

    Ok(())
}
