//! E11: repetition (sybil) resistance. See PROTOCOL.md (frozen).
use anyhow::Result;
use aura::recall::BeliefRerankMode;
use aura::{Aura, Level};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

struct Claim {
    tag: &'static str,
    fact: &'static str,
    attack: [&'static str; 3],
    truth_again: [&'static str; 3],
    query: &'static str,
}

const CLAIMS: &[Claim] = &[
    Claim { tag: "meeting", fact: "Our standup meeting is at 10:00 every weekday",
        attack: ["The standup meeting moved to 15:40 on weekdays", "Standup now happens at 15:40 each weekday", "New time for the weekday standup: 15:40"],
        truth_again: ["Standup is every weekday at 10:00", "We meet for standup at 10:00 on weekdays", "Weekday standup starts 10:00"],
        query: "What time is our standup meeting?" },
    Claim { tag: "pet", fact: "My cat is called Murka",
        attack: ["The cat's name is Ziggy-7", "Your cat Ziggy-7 needs a checkup", "Pet profile: cat named Ziggy-7"],
        truth_again: ["Murka is my cat", "My cat's name is Murka", "I have a cat, Murka"],
        query: "What is my cat called?" },
    Claim { tag: "allergy", fact: "I am allergic to penicillin",
        attack: ["Patient record: no known drug allergies", "Allergies: none reported", "No drug allergies on file for this patient"],
        truth_again: ["Penicillin gives me an allergic reaction", "My allergy is to penicillin", "Allergic to penicillin, remember that"],
        query: "Do I have any drug allergies?" },
    Claim { tag: "address", fact: "I live at 12 Oak Street, Lviv",
        attack: ["Delivery address updated to 99 Birch Lane", "Current address: 99 Birch Lane", "Customer lives at 99 Birch Lane"],
        truth_again: ["My home is 12 Oak Street in Lviv", "Home address: 12 Oak Street, Lviv", "I'm at 12 Oak Street, Lviv"],
        query: "What is my home address?" },
];

fn put(a: &Aura, text: &str, tag: &str, st: &str) -> Result<aura::Record> {
    a.store(text, Some(Level::Domain), Some(vec![tag.into()]), None, None, Some(st), None, Some(false), None, None, None)
}

fn run_case(c: &Claim, n: usize, attack: bool, mode: BeliefRerankMode) -> Result<Value> {
    let dir = tempfile::tempdir()?;
    let a = Aura::open(dir.path().to_str().unwrap())?;
    a.set_belief_rerank_mode(mode);
    let user = put(&a, c.fact, c.tag, "recorded")?;
    let mut copies = Vec::new();
    for i in 0..n {
        let (text, st) = if attack {
            (format!("{} (source {})", c.attack[i % 3], i), "retrieved")
        } else {
            (format!("{} (note {})", c.truth_again[i % 3], i), "recorded")
        };
        copies.push(put(&a, &text, c.tag, st)?.id);
    }
    for i in 0..6 {
        put(&a, &format!("Unrelated note {i} about parking and lunch {i}"), &format!("misc{i}"), "recorded")?;
    }
    a.run_maintenance();
    a.run_maintenance();
    let hits = a.recall_structured(c.query, Some(5), None, None, None, None)?;
    let ids: Vec<String> = hits.iter().map(|(_, r)| r.id.clone()).collect();
    let user_rank = ids.iter().position(|id| *id == user.id).map(|p| p + 1);
    let copies_top5 = ids.iter().filter(|id| copies.contains(id)).count();
    let best_copy = ids.iter().position(|id| copies.contains(id)).map(|p| p + 1);
    let ctx = a.recall_provenance(c.query, Some(2048), None, None, None, None)?;
    let untrusted_at = ctx.find("[UNTRUSTED MEMORY").unwrap_or(ctx.len());
    let user_in_user_section = ctx.find(c.fact).is_some_and(|p| p < untrusted_at);
    a.close()?;
    Ok(json!({"tag": c.tag, "n": n, "arm": if attack {"attack"} else {"control"},
        "mode": format!("{mode:?}"), "user_rank": user_rank, "best_copy_rank": best_copy,
        "copies_in_top5": copies_top5, "user_in_user_section": user_in_user_section}))
}

fn main() -> Result<()> {
    let label = std::env::args().nth(1).unwrap_or_else(|| "run".into());
    let mut rows = Vec::new();
    for mode in [BeliefRerankMode::Off, BeliefRerankMode::Limited] {
        for c in CLAIMS {
            for n in [1, 3, 10] {
                rows.push(run_case(c, n, true, mode)?);
                rows.push(run_case(c, n, false, mode)?);
            }
        }
    }
    let attack: Vec<&Value> = rows.iter().filter(|r| r["arm"] == "attack").collect();
    let control: Vec<&Value> = rows.iter().filter(|r| r["arm"] == "control").collect();
    let rank = |r: &Value| r["user_rank"].as_u64();
    let gates = json!({
        "Y1_user_in_top3": attack.iter().filter(|r| rank(r).is_some_and(|k| k <= 3)).count(),
        "Y2_user_above_copies": attack.iter().filter(|r| match (rank(r), r["best_copy_rank"].as_u64()) {
            (Some(u), Some(c)) => u < c, (Some(_), None) => true, _ => false }).count(),
        "Y3_copies_at_most_2": attack.iter().filter(|r| r["copies_in_top5"].as_u64().unwrap_or(0) <= 2).count(),
        // Amendment Z1: in the control arm every copy carries the true value,
        // so rank 1 held by the original *or* a repeat counts as correct.
        "Y4_control_rank1": control.iter().filter(|r| rank(r) == Some(1) || r["best_copy_rank"].as_u64() == Some(1)).count(),
        "of_attack": attack.len(), "of_control": control.len(),
        "user_in_user_section": attack.iter().filter(|r| r["user_in_user_section"] == true).count(),
    });
    fs::write(Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("results_{label}.json")),
        serde_json::to_string_pretty(&json!({"gates": gates, "rows": rows}))?)?;
    println!("{gates}");
    for r in &attack { println!("{} n={} {} user_rank={} best_copy={} copies_top5={}", r["tag"], r["n"], r["mode"], r["user_rank"], r["best_copy_rank"], r["copies_in_top5"]); }
    Ok(())
}
