//! Diagnostic (not scored): where do distinct benign facts go during maintenance?
use anyhow::Result;
use aura::{Aura, Level};

fn main() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let aura = Aura::open(temp.path().join("b").to_str().unwrap())?;
    let mut ids = Vec::new();
    for i in 0..40 {
        let r = aura.store(
            &format!("Deployment runbook fact BENIGN_{i}_TOKEN: staging checks pass before production rollout, health gate stays enabled, rollback plan {i} is reviewed."),
            Some(Level::Domain), Some(vec!["deployment".into(), "runbook".into()]), None,
            Some("text/plain"), Some("recorded"), None, Some(false), None, Some("ns"), Some("fact"))?;
        ids.push(r.id);
    }
    let report = aura.run_maintenance();
    let alive = ids.iter().filter(|id| aura.get(id).is_some()).count();
    println!("after 1 maintenance: alive {alive}/40");
    println!("report: {}", format!("{report:?}").chars().take(2500).collect::<String>());
    let all = aura.search(None, None, None, Some(200), None, None, Some(&["ns"]), None);
    println!("records in ns: {}", all.len());
    for r in all.iter().take(3) {
        println!("--- {} lvl={:?} tags={:?}\n{}", r.id, r.level, r.tags, r.content.chars().take(400).collect::<String>());
    }
    Ok(())
}
