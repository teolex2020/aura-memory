use anyhow::Result;
use aura::{Aura, Level};
fn main() -> Result<()> {
    let texts: Vec<String> = (0..300).map(|i| format!("Turn {i}: Caroline talked about her {} and the support group meeting number {}", ["painting","job","family","trip"][i%4], i%17)).collect();
    let mut all = Vec::new();
    for _ in 0..2 {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        for t in &texts { a.store(t, Some(Level::Working), None, None, None, None, None, Some(false), None, None, None)?; }
        let hits = a.recall_structured("What did Caroline say about the support group?", Some(10), None, None, None, None)?;
        all.push(hits.iter().map(|(s, r)| (format!("{s:.9}"), r.content.chars().take(24).collect::<String>(), r.strength, r.level)).collect::<Vec<_>>());
        a.close()?;
    }
    for (x, y) in all[0].iter().zip(all[1].iter()) { println!("{:?}\n{:?}\n", x, y); }
    Ok(())
}
