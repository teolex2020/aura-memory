use aura::cognitive_store::CognitiveStore;
use serde_json::json;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let dir = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("missing dir arg"))?;
    let dir = PathBuf::from(dir);
    let store = CognitiveStore::new(&dir)?;
    let records = store.load_all()?;
    let mut ids: Vec<String> = records.keys().cloned().collect();
    ids.sort();
    let first = ids.first().and_then(|id| records.get(id));
    let out = json!({
        "count": records.len(),
        "ids": ids,
        "first_content": first.map(|r| r.content.clone())
    });
    println!("{}", out);
    Ok(())
}

