//! E5: language-independent outcome polarity. See PROTOCOL.md (frozen).

use anyhow::Result;
use aura::{Aura, Level};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

struct Case {
    lang: &'static str,
    outcome: &'static str,
    causes: [&'static str; 2],
    effects: [&'static str; 2],
}

const CASES: &[Case] = &[
    Case { lang: "en", outcome: "negative",
        causes: ["Deployed straight to production without staging on Friday", "Pushed the release to production skipping staging at night"],
        effects: ["Checkout stopped working for customers after that release", "Payments went down for two hours after the release"] },
    Case { lang: "uk", outcome: "negative",
        causes: ["Задеплоїли прямо в продакшн без стейджингу в п'ятницю", "Випустили реліз у продакшн уночі, оминувши стейджинг"],
        effects: ["Після того релізу оформлення замовлень перестало працювати", "Платежі лежали дві години після релізу"] },
    Case { lang: "de", outcome: "negative",
        causes: ["Am Freitag direkt ohne Staging in die Produktion ausgerollt", "Das Release nachts ohne Staging in die Produktion gebracht"],
        effects: ["Nach dem Release funktionierte der Checkout nicht mehr", "Die Zahlungen waren nach dem Release zwei Stunden ausgefallen"] },
    Case { lang: "en", outcome: "positive",
        causes: ["Deployed to staging first and ran the smoke suite", "Rolled out through staging with the health gate on"],
        effects: ["Customers noticed quicker page loads after that release", "The release went live and orders kept flowing smoothly"] },
    Case { lang: "uk", outcome: "positive",
        causes: ["Спершу задеплоїли на стейджинг і прогнали смоук-тести", "Викотили через стейджинг з увімкненим health gate"],
        effects: ["Після релізу сторінки почали вантажитися помітно швидше", "Реліз вийшов, і замовлення йшли без перебоїв"] },
    Case { lang: "de", outcome: "positive",
        causes: ["Zuerst auf Staging ausgerollt und die Smoke-Tests laufen lassen", "Über Staging mit aktiviertem Health Gate ausgerollt"],
        effects: ["Nach dem Release luden die Seiten spürbar schneller", "Das Release ging live und Bestellungen liefen reibungslos"] },
];

fn put(aura: &Aura, text: &str, tag: &str, caused_by: Option<&str>, meta: Option<HashMap<String, String>>) -> Result<aura::Record> {
    aura.store(text, Some(Level::Domain), Some(vec![tag.to_string()]), None, None,
        Some("recorded"), meta, Some(false), caused_by, Some("e5"), None)
}

fn run_case(case: &Case) -> Result<Value> {
    let dir = tempfile::tempdir()?;
    let aura = Aura::open(dir.path().join("b").to_str().unwrap())?;
    // Diagnostic arm only (not gated): explicit caused_by edges without
    // requiring belief clusters on both sides.
    if std::env::var("E5_EXPLICIT").is_ok() {
        aura.set_causal_evidence_mode(aura::causal::CausalEvidenceMode::ExplicitTrusted);
    }
    let mut ids = Vec::new();
    for (cause, effect) in case.causes.iter().zip(case.effects.iter()) {
        let c = put(&aura, cause, "deploy", None, None)?;
        let meta = HashMap::from([("outcome".to_string(), case.outcome.to_string())]);
        let e = put(&aura, effect, "result", Some(&c.id), Some(meta))?;
        ids.push(c.id);
        ids.push(e.id);
    }
    for i in 0..6 {
        put(&aura, &format!("Filler note {i} about parking and lunch {i}"), &format!("misc{i}"), None, None)?;
    }
    aura.run_maintenance();
    aura.run_maintenance();
    let actions: Vec<String> = aura
        .get_surfaced_policy_hints(None)
        .into_iter()
        .filter(|h| h.supporting_record_ids.iter().all(|id| ids.contains(id)))
        .map(|h| h.action_kind)
        .collect();
    if std::env::var("E5_DEBUG").is_ok() {
        let beliefs = aura.get_beliefs(None);
        let causal = aura.get_causal_patterns(None);
        let hints = aura.get_policy_hints(None);
        eprintln!(
            "[{} {}] beliefs={} causal={} (states {:?}) hints={:?}",
            case.lang,
            case.outcome,
            beliefs.len(),
            causal.len(),
            causal.iter().filter(|p| p.cause_record_ids.iter().any(|id| ids.contains(id))).map(|p| format!("{:?} s={:.2} +{} -{}", p.state, p.causal_strength, p.positive_effect_signals, p.negative_effect_signals)).collect::<Vec<_>>(),
            hints.iter().map(|h| format!("{:?}/{:?} {:.2}", h.action_kind, h.state, h.policy_strength)).collect::<Vec<_>>()
        );
    }
    let expected: &[&str] = if case.outcome == "negative" { &["avoid", "verify"] } else { &["prefer", "recommend"] };
    let correct = !actions.is_empty() && actions.iter().all(|a| expected.contains(&a.as_str()));
    Ok(json!({"lang": case.lang, "outcome": case.outcome, "actions": actions, "correct": correct}))
}

fn source_has_word_lists() -> bool {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src");
    ["policy.rs", "causal.rs"].iter().any(|f| {
        fs::read_to_string(root.join(f))
            .map(|s| s.contains("NEGATIVE_KEYWORDS") || s.contains("NEGATIVE_OUTCOME_KEYWORDS"))
            .unwrap_or(true)
    })
}

fn main() -> Result<()> {
    let label = std::env::args().nth(1).unwrap_or_else(|| "run".into());
    let rows: Vec<Value> = CASES.iter().map(run_case).collect::<Result<_>>()?;
    let all = |outcome: &str| rows.iter().filter(|r| r["outcome"] == outcome).all(|r| r["correct"] == true);
    let gates = json!({
        "O1_negative_parity": all("negative"),
        "O2_positive_parity": all("positive"),
        "O3_no_word_lists": !source_has_word_lists(),
    });
    let out = json!({"schema": "outcome-polarity-v1", "run": label, "cases": rows, "gates": gates});
    fs::write(Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("results_{label}.json")), serde_json::to_string_pretty(&out)?)?;
    for r in &rows { println!("{} {:8} -> {}", r["lang"], r["outcome"], r["actions"]); }
    println!("gates: {gates}");
    Ok(())
}
