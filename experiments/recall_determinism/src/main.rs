//! E8: recall determinism. See PROTOCOL.md (frozen).
//! Usage: aura-recall-determinism <label>  -> results_<label>.json

use anyhow::Result;
use aura::{Aura, Level};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const DATASET: &str = "D:/Aura-clean/target/aura-local/external-benchmarks/locomo/locomo10.json";

fn corpus() -> Result<(Vec<(usize, String)>, Vec<(usize, String)>)> {
    let data: Value = serde_json::from_str(&fs::read_to_string(DATASET)?)?;
    let mut turns = Vec::new();
    let mut questions = Vec::new();
    for (ci, conv) in data.as_array().unwrap().iter().enumerate().take(3) {
        let c = &conv["conversation"];
        let mut sessions: Vec<(u32, &str)> = c
            .as_object()
            .unwrap()
            .keys()
            .filter_map(|k| {
                k.strip_prefix("session_")
                    .and_then(|n| n.parse::<u32>().ok())
                    .map(|n| (n, k.as_str()))
            })
            .collect();
        sessions.sort();
        for (n, key) in sessions {
            let date = c[format!("session_{n}_date_time")].as_str().unwrap_or("");
            if let Some(list) = c[key].as_array() {
                for t in list {
                    turns.push((
                        ci,
                        format!(
                            "[C{ci} {} | {date}] {}: {}",
                            t["dia_id"].as_str().unwrap_or(""),
                            t["speaker"].as_str().unwrap_or(""),
                            t["text"].as_str().unwrap_or("")
                        ),
                    ));
                }
            }
        }
        for q in conv["qa"].as_array().unwrap() {
            if let Some(text) = q["question"].as_str() {
                questions.push((ci, text.to_string()));
            }
        }
    }
    questions.truncate(200);
    Ok((turns, questions))
}

fn run_once(turns: &[(usize, String)], questions: &[(usize, String)]) -> Result<Vec<Vec<String>>> {
    let dir = tempfile::tempdir()?;
    let stores: Vec<Aura> = (0..3)
        .map(|ci| Aura::open(dir.path().join(format!("c{ci}")).to_str().unwrap()))
        .collect::<Result<_>>()?;
    // Diagnostic only (E8_NO_RECENCY): remove the wall-clock recency boost to
    // test whether it causes the remaining near-tie swaps.
    if std::env::var("E8_NO_RECENCY").is_ok() {
        for s in &stores {
            let mut config = aura::trust::TrustConfig::default();
            config.recency_boost_max = 0.0;
            s.set_trust_config(config);
        }
    }
    for (ci, text) in turns {
        stores[*ci].store(text, Some(Level::Working), None, None, None, None, None, Some(false), None, None, None)?;
    }
    let mut out = Vec::new();
    for (ci, q) in questions {
        let hits = stores[*ci].recall_structured(q, Some(50), None, None, None, None)?;
        out.push(hits.into_iter().map(|(_, r)| r.content).collect());
    }
    for s in &stores {
        s.close()?;
    }
    Ok(out)
}

fn identical(a: &[Vec<String>], b: &[Vec<String>]) -> usize {
    a.iter().zip(b).filter(|(x, y)| x == y).count()
}

fn main() -> Result<()> {
    let label = std::env::args().nth(1).unwrap_or_else(|| "run".into());
    let (turns, questions) = corpus()?;
    let a = run_once(&turns, &questions)?;
    let b = run_once(&turns, &questions)?;
    let in_process = identical(&a, &b);
    let here = Path::new(env!("CARGO_MANIFEST_DIR"));
    fs::write(here.join(format!("rankings_{label}.json")), serde_json::to_string(&a)?)?;
    let out = json!({"label": label, "turns": turns.len(), "questions": questions.len(),
        "in_process_identical": in_process});
    fs::write(here.join(format!("results_{label}.json")), serde_json::to_string_pretty(&out)?)?;
    println!("{out}");
    Ok(())
}
