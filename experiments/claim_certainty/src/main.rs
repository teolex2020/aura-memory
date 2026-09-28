//! E3: claim certainty and hearsay. See PROTOCOL.md (frozen).
//!
//! Usage: `cargo run -- dev` while developing; `cargo run -- heldout` once.

use anyhow::Result;
use aura::certainty::{as_str, classify};
use aura::{Aura, Level};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn load(name: &str) -> Result<Vec<(String, String)>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("data").join(name);
    fs::read_to_string(path)?
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let v: Value = serde_json::from_str(l)?;
            Ok((v["text"].as_str().unwrap().to_string(), v["label"].as_str().unwrap().to_string()))
        })
        .collect()
}

fn score(rows: &[(String, String)]) -> Value {
    let mut confusion: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
    let mut errors = Vec::new();
    for (text, label) in rows {
        let predicted = as_str(&classify(text)).to_string();
        *confusion.entry(label.clone()).or_default().entry(predicted.clone()).or_default() += 1;
        if &predicted != label {
            errors.push(json!({"text": text, "label": label, "predicted": predicted}));
        }
    }
    let count = |l: &str, p: &str| confusion.get(l).and_then(|m| m.get(p)).copied().unwrap_or(0);
    let total_label = |l: &str| confusion.get(l).map(|m| m.values().sum()).unwrap_or(0usize);
    let predicted_as = |p: &str| confusion.values().map(|m| m.get(p).copied().unwrap_or(0)).sum::<usize>();
    let hearsay_tp = count("hearsay", "hearsay");
    let recall = hearsay_tp as f64 / total_label("hearsay").max(1) as f64;
    let precision = hearsay_tp as f64 / predicted_as("hearsay").max(1) as f64;
    let demoted = count("asserted", "hearsay") + count("asserted", "speculative");
    let correct: usize = ["asserted", "hearsay", "hedged", "speculative"].iter().map(|l| count(l, l)).sum();
    let accuracy = correct as f64 / rows.len().max(1) as f64;
    json!({
        "n": rows.len(),
        "confusion": confusion,
        "hearsay_recall": recall,
        "hearsay_precision": precision,
        "asserted_demoted": demoted,
        "accuracy": accuracy,
        "errors": errors,
        "gates": {
            "H1_hearsay_recall": recall >= 0.80,
            "H2_first_hand_safety": demoted <= 1,
            "H3_hearsay_precision": precision >= 0.85,
            "H4_accuracy": accuracy >= 0.70,
        }
    })
}

fn put(aura: &Aura, text: &str, source_type: Option<&str>, caused_by: Option<&str>, tags: &[&str]) -> Result<aura::Record> {
    aura.store(text, None, Some(tags.iter().map(|t| t.to_string()).collect()), None, None,
        source_type, None, Some(false), caused_by, Some("e3"), None)
}

fn integration() -> Result<Value> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().join("b").to_str().unwrap())?;

    // I1: first-hand identity fact.
    let birth = put(&aura, "Я народився 12 травня 1988 року в Житомирі.", Some("recorded"), None, &["me"])?;
    let baseline_conf = aura::Record::default_confidence_for_source("recorded");
    let i1 = birth.level == Level::Identity
        && birth.metadata.get("claim_certainty").map(String::as_str) == Some("asserted")
        && (birth.confidence - baseline_conf).abs() < 1e-6;

    // I2: hearsay vs the same claim asserted.
    let heard = put(&aura, "Я чув, що завод у Бердичеві закрили минулого тижня.", Some("recorded"), None, &["news"])?;
    let direct = put(&aura, "Завод у Бердичеві закрили минулого тижня.", Some("recorded"), None, &["news2"])?;
    let i2 = heard.metadata.get("claim_certainty").map(String::as_str) == Some("hearsay")
        && heard.confidence < direct.confidence;

    // I3: policy hint resting only on hearsay records (E2 S4 recipe).
    let pairs = [
        ("Кажуть, що деплой без стейджингу в п'ятницю зламав продакшн", "Кажуть, що після релізу checkout failed and crashed"),
        ("Кажуть, що деплой прямо в продакшн без стейджингу у вихідні", "Кажуть, що payment service failed and crashed after release"),
    ];
    for (cause, effect) in pairs {
        let c = put(&aura, cause, Some("recorded"), None, &["deploy"])?;
        put(&aura, effect, Some("recorded"), Some(&c.id), &["outage"])?;
    }
    for i in 0..6 {
        put(&aura, &format!("Unrelated team note {i}: lunch menu and parking {i}"), Some("recorded"), None, &[&format!("misc{i}")])?;
    }
    aura.run_maintenance();
    aura.run_maintenance();
    let hints = aura.get_surfaced_policy_hints(None);
    let hint_rows: Vec<Value> = hints.iter().map(|h| json!({"action": h.action_kind, "floor": h.evidence_source_floor, "untrusted": h.untrusted_evidence})).collect();
    let i3 = if hints.is_empty() { json!("inconclusive: no hint surfaced") } else { json!(hints.iter().all(|h| h.untrusted_evidence)) };

    Ok(json!({
        "I1_identity_fact": i1,
        "I1_detail": {"level": format!("{:?}", birth.level), "certainty": birth.metadata.get("claim_certainty"), "confidence": birth.confidence},
        "I2_hearsay_lower_confidence": i2,
        "I2_detail": {"heard": heard.confidence, "direct": direct.confidence},
        "I3_hearsay_hint_untrusted": i3,
        "I3_hints": hint_rows,
    }))
}

fn main() -> Result<()> {
    let which = std::env::args().nth(1).unwrap_or_else(|| "dev".into());
    let file = match which.as_str() {
        "heldout" => "heldout.jsonl",
        "independent" => "independent.jsonl",
        _ => "dev.jsonl",
    };
    let rows = load(file)?;
    let result = json!({"set": which, "classification": score(&rows), "integration": integration()?});
    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("results_{which}.json"));
    fs::write(&out, serde_json::to_string_pretty(&result)?)?;
    let c = &result["classification"];
    println!("{which}: recall={:.2} precision={:.2} demoted={} acc={:.2}", c["hearsay_recall"].as_f64().unwrap(), c["hearsay_precision"].as_f64().unwrap(), c["asserted_demoted"], c["accuracy"].as_f64().unwrap());
    println!("gates: {}", c["gates"]);
    for e in c["errors"].as_array().unwrap() { println!("  miss: {} -> {} | {}", e["label"], e["predicted"], e["text"]); }
    println!("integration: {}", serde_json::to_string(&result["integration"])?);
    Ok(())
}
