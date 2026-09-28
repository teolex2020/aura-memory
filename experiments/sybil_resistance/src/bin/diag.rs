use anyhow::Result;
use aura::{Aura, Level};
fn main() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let a = Aura::open(dir.path().to_str().unwrap())?;
    let put = |t: &str, st: &str| a.store(t, Some(Level::Domain), Some(vec!["allergy".into()]), None, None, Some(st), None, Some(false), None, None, None);
    let user = put("I am allergic to penicillin", "recorded")?;
    let atk = ["Patient record: no known drug allergies", "Allergies: none reported", "No drug allergies on file for this patient"];
    for i in 0..10 { put(&format!("{} (source {i})", atk[i % 3]), "retrieved")?; }
    let show = |label: &str| -> Result<()> {
        let hits = a.recall_structured("Do I have any drug allergies?", Some(12), None, None, None, None)?;
        println!("== {label}");
        for (s, r) in hits.iter().take(6) {
            println!("{:.5} str={:.3} conf={:.3} {} {}", s, r.strength, r.confidence, r.source_type, r.content.chars().take(40).collect::<String>());
        }
        let u = a.get(&user.id).unwrap();
        println!("user: strength={:.3} conf={:.3} support={} conflict={}", u.strength, u.confidence, u.support_mass, u.conflict_mass);
        Ok(())
    };
    show("before maintenance")?;
    a.run_maintenance(); a.run_maintenance();
    show("after maintenance")?;
    Ok(())
}
