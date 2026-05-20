use aura::cognitive_store::CognitiveStore;
use aura::index::InvertedIndex;
use aura::ngram::NGramIndex;
use aura::recall;
use aura::record::Record;
use aura::sdr::SDRInterpreter;
use aura::storage::AuraStorage;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

fn build_tag_index(records: &HashMap<String, Record>) -> HashMap<String, HashSet<String>> {
    let mut out: HashMap<String, HashSet<String>> = HashMap::new();
    for rec in records.values() {
        for t in &rec.tags {
            out.entry(t.to_lowercase())
                .or_default()
                .insert(rec.id.clone());
        }
    }
    out
}

fn build_aura_index(records: &HashMap<String, Record>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for rec in records.values() {
        if let Some(ref aid) = rec.aura_id {
            out.insert(aid.clone(), rec.id.clone());
        }
    }
    out
}

fn main() -> anyhow::Result<()> {
    let brain_dir = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing brain_dir arg"))?;
    let query = std::env::args()
        .nth(2)
        .ok_or_else(|| anyhow::anyhow!("missing query arg"))?;

    let brain_dir = PathBuf::from(brain_dir);

    let store = CognitiveStore::new(&brain_dir)?;
    let records = store.load_all()?;

    let tag_index = build_tag_index(&records);
    let aura_index = build_aura_index(&records);

    let storage = AuraStorage::new(&brain_dir)?;
    let index_dir = brain_dir.join("index");
    let index = InvertedIndex::new(&index_dir);
    index.load()?;

    let mut ngram = NGramIndex::with_seed(None, None, 0);
    for rec in records.values() {
        ngram.add(&rec.id, &rec.content);
    }

    let sdr = SDRInterpreter::default();

    let scored = recall::recall_pipeline(
        &query,
        10,
        0.0,
        false,
        &sdr,
        &index,
        &storage,
        &ngram,
        &tag_index,
        &aura_index,
        &records,
        None,
        None,
        None,
    );

    let ids: Vec<String> = scored.into_iter().map(|(_, r)| r.id).collect();
    println!("{}", serde_json::to_string(&ids)?);

    Ok(())
}

