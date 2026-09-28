//! Reported check (not a frozen gate): several *different* legitimate facts
//! from one untrusted source must stay retrievable.
use anyhow::Result;
use aura::{Aura, Level};
fn main() -> Result<()> {
    let facts = [
        ("Store hours Monday to Friday: 09:00-20:00", "When is the store open on weekdays?", "09:00-20:00"),
        ("Store hours Saturday: 10:00-18:00", "When is the store open on Saturday?", "10:00-18:00"),
        ("Store hours Sunday: closed", "Is the store open on Sunday?", "closed"),
        ("Store phone for returns: extension 4412", "What is the returns extension?", "4412"),
        ("Store parking is behind the building, level P2", "Where do I park at the store?", "P2"),
    ];
    let mut found = 0;
    for (i, (_, q, token)) in facts.iter().enumerate() {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        let mut meta = std::collections::HashMap::new();
        meta.insert("channel".to_string(), "web".to_string());
        for (text, _, _) in &facts {
            a.store(text, Some(Level::Domain), Some(vec!["store".into()]), None, None, Some("retrieved"), Some(meta.clone()), Some(false), None, None, None)?;
        }
        for j in 0..6 { a.store(&format!("Unrelated note {j} about lunch {j}"), Some(Level::Domain), Some(vec![format!("misc{j}")]), None, None, Some("recorded"), None, Some(false), None, None, None)?; }
        let hits = a.recall_structured(q, Some(5), None, None, None, None)?;
        let ok = hits.iter().any(|(_, r)| r.content.contains(token));
        println!("fact {i}: {} -> {}", q, if ok { "found" } else { "MISSING" });
        if !ok {
            for (sc, r) in a.recall_structured(q, Some(8), None, None, None, None)? {
                println!("    {sc:.5} {} {}", r.source_type, r.content);
            }
        }
        found += ok as usize;
        a.close()?;
    }
    println!("benign group: {found}/{} found in top-5", facts.len());
    Ok(())
}
