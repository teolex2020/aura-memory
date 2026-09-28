//! Embedding persistence: append-only inserts survive reopen, a torn log tail
//! is dropped, and removal leaves no trace of the record id on disk.

use aura::{Aura, Level, Record};

fn store(aura: &Aura, text: &str) -> Record {
    aura.store(
        text,
        Some(Level::Working),
        None,
        None,
        None,
        None,
        None,
        Some(false),
        None,
        None,
        None,
    )
    .unwrap()
}

fn files_containing(dir: &std::path::Path, needle: &str) -> Vec<String> {
    let mut hits = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Ok(bytes) = std::fs::read(&path) {
                if bytes.windows(needle.len()).any(|w| w == needle.as_bytes()) {
                    hits.push(path.file_name().unwrap().to_string_lossy().to_string());
                }
            }
        }
    }
    hits
}

#[test]
fn inserts_survive_reopen_and_rank_the_same() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let ids: Vec<String> = {
        let aura = Aura::open(path).unwrap();
        let ids = (0..50)
            .map(|i| {
                let rec = store(&aura, &format!("note number {i} about deployments"));
                let mut v = vec![0.0f32; 8];
                v[i % 8] = 1.0;
                v[(i + 1) % 8] = 0.5;
                aura.store_embedding(&rec.id, v).unwrap();
                rec.id
            })
            .collect();
        aura.close().unwrap();
        ids
    };
    let aura = Aura::open(path).unwrap();
    let hits = aura
        .recall_with_embedding(
            "deployments",
            &{
                let mut q = vec![0.0f32; 8];
                q[3] = 1.0;
                q[4] = 0.5;
                q
            },
            Some(5),
            Some(0.0),
            Some(false),
            None,
        )
        .unwrap();
    // Records 3, 11, 19, ... share the closest vector; after reopen at least
    // one of them must still rank in the top 5 (which one is decided by
    // content, not by random id).
    let closest: Vec<&String> = ids.iter().skip(3).step_by(8).collect();
    assert!(hits.iter().any(|(_, r)| closest.contains(&&r.id)));
    assert!(aura.has_embeddings());
}

#[test]
fn torn_log_tail_is_dropped_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let kept = {
        let aura = Aura::open(path).unwrap();
        let rec = store(&aura, "a record whose embedding must survive");
        aura.store_embedding(&rec.id, vec![1.0, 0.0]).unwrap();
        aura.close().unwrap();
        rec.id
    };
    let log = dir.path().join("embeddings.log");
    if log.exists() {
        let mut bytes = std::fs::read(&log).unwrap();
        bytes.extend_from_slice(&[9, 0, 0, 0, 1, 2]); // half a frame
        std::fs::write(&log, bytes).unwrap();
    }
    let aura = Aura::open(path).unwrap();
    let hits = aura
        .recall_with_embedding(
            "survive",
            &[1.0, 0.0],
            Some(3),
            Some(0.0),
            Some(false),
            None,
        )
        .unwrap();
    assert!(hits.iter().any(|(_, r)| r.id == kept));
}

#[test]
fn removal_leaves_no_record_id_in_embedding_files() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let keep = store(&aura, "embedding that stays in the store");
    let gone = store(&aura, "embedding that will be purged completely");
    aura.store_embedding(&keep.id, vec![1.0, 0.0]).unwrap();
    aura.store_embedding(&gone.id, vec![0.0, 1.0]).unwrap();
    aura.delete(&gone.id).unwrap();
    aura.flush().unwrap();
    let hits: Vec<String> = files_containing(dir.path(), &gone.id)
        .into_iter()
        .filter(|f| f.starts_with("embeddings"))
        .collect();
    assert!(hits.is_empty(), "removed id still in {hits:?}");
}
