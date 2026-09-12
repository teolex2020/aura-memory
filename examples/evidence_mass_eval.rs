//! Compact retention surrogate, not a full SDK performance/quality benchmark.
//! Exploratory protocol: experiments/evidence_mass_eval/PROTOCOL.md.
use anyhow::{ensure, Result};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::mem::size_of;
use std::time::Instant;

#[derive(Clone, Deserialize)]
struct Event {
    case: u64,
    state: u64,
    context: u64,
    time: String,
    source_position: usize,
}
#[derive(Deserialize)]
struct Dataset {
    name: String,
    events: Vec<Event>,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Kind {
    RouteDecay,
    NoDecay,
    Frequency,
    Recency,
    Utility,
    ContextUtility,
    MassUtility,
    MassContextUtility,
}
#[derive(Clone, Copy, Debug, Serialize)]
struct Policy {
    kind: Kind,
    attenuation: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    context: u64,
    from: u64,
    to: u64,
}
#[derive(Clone, Copy, Debug)]
struct Entry {
    key: Key,
    generation: u64,
    benefit: f64,
    last_feedback: u64,
    last_use: u64,
    observations: u32,
    activations: u32,
    receipts: u32,
    evidence_mass: f32,
    strength: f32,
    confirmed: bool,
}
#[derive(Clone, Copy)]
struct Prediction {
    key: Key,
    generation: u64,
}
struct Memory {
    entries: Vec<Entry>,
    policy: Policy,
    epoch: u64,
    context: u64,
    next_generation: u64,
    capacity: usize,
    peak_slots: usize,
    dropped_feedback: u64,
    evictions: u64,
    rejected: u64,
}
impl Memory {
    fn new(policy: Policy, budget: usize) -> Self {
        let fixed = size_of::<Self>() + size_of::<Entry>();
        assert!(budget >= fixed + size_of::<Entry>());
        let capacity = (budget - fixed) / size_of::<Entry>();
        let result = Self {
            entries: Vec::with_capacity(capacity),
            policy,
            epoch: 0,
            context: 0,
            next_generation: 1,
            capacity,
            peak_slots: 0,
            dropped_feedback: 0,
            evictions: 0,
            rejected: 0,
        };
        assert!(result.charged_bytes() <= budget);
        result
    }
    fn charged_bytes(&self) -> usize {
        size_of::<Self>() + size_of::<Entry>() + self.entries.capacity() * size_of::<Entry>()
    }
    fn tick(&mut self, context: u64) {
        self.epoch += 1;
        self.context = context;
        if self.policy.kind == Kind::RouteDecay {
            for e in &mut self.entries {
                e.strength *= if e.confirmed { 0.98 } else { 0.80 };
            }
            let before = self.entries.len();
            self.entries.retain(|e| e.strength >= 0.05);
            self.evictions += (before - self.entries.len()) as u64;
        }
    }
    fn score(&self, e: &Entry) -> f64 {
        // Same importance components as a Working Record with no edges/salience.
        let base =
            (0.4 * e.strength + 0.25 / 4.0 + 0.15 * (e.activations as f32 / 20.0).min(1.0)) as f64;
        match self.policy.kind {
            Kind::Frequency => 1.0 + e.activations as f64,
            Kind::Recency => 1.0 / (1.0 + (self.epoch - e.last_use) as f64),
            Kind::Utility | Kind::ContextUtility | Kind::MassUtility | Kind::MassContextUtility => {
                let factor = if matches!(
                    self.policy.kind,
                    Kind::ContextUtility | Kind::MassContextUtility
                ) && e.key.context != 0
                    && e.key.context != self.context
                {
                    self.policy.attenuation
                } else {
                    1.0
                };
                base + factor * self.bonus(e)
            }
            _ => base,
        }
    }
    fn bonus(&self, e: &Entry) -> f64 {
        let fade = 2.0_f64.powf(-((self.epoch - e.last_feedback) as f64) / 128.0);
        if matches!(
            self.policy.kind,
            Kind::MassUtility | Kind::MassContextUtility
        ) {
            let mean = fade * e.benefit / (1.0 + fade * e.evidence_mass as f64);
            mean.signum() * mean.abs().ln_1p()
        } else {
            let mean = e.benefit / (1.0 + e.receipts as f64);
            mean.signum() * mean.abs().ln_1p() * fade
        }
    }
    fn observe(&mut self, key: Key) {
        if let Some(e) = self.entries.iter_mut().find(|e| e.key == key) {
            e.observations = e.observations.saturating_add(1);
            return;
        }
        let incoming = Entry {
            key,
            generation: self.next_generation,
            benefit: 0.0,
            last_feedback: self.epoch,
            last_use: self.epoch,
            observations: 1,
            activations: 0,
            receipts: 0,
            evidence_mass: 0.0,
            strength: 1.0,
            confirmed: false,
        };
        self.next_generation += 1;
        if self.entries.len() < self.capacity {
            self.entries.push(incoming);
        } else {
            let (victim, e) = self
                .entries
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    self.score(a)
                        .total_cmp(&self.score(b))
                        .then(a.key.cmp(&b.key))
                })
                .unwrap();
            let order = self
                .score(&incoming)
                .total_cmp(&self.score(e))
                .then(incoming.key.cmp(&e.key));
            if order.is_gt() {
                self.entries[victim] = incoming;
                self.evictions += 1;
            } else {
                self.rejected += 1;
            }
        }
        self.peak_slots = self.peak_slots.max(self.entries.len());
    }
    fn predict(&mut self, context: u64, state: u64) -> Option<Prediction> {
        let pos = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, e)| {
                e.key.from == state && (e.key.context == context || e.key.context == 0)
            })
            .max_by(|(_, a), (_, b)| {
                (a.key.context == context)
                    .cmp(&(b.key.context == context))
                    .then(a.observations.cmp(&b.observations))
                    .then(b.key.cmp(&a.key))
            })
            .map(|(i, _)| i)?;
        let e = &mut self.entries[pos];
        e.strength = (e.strength + 0.2).min(1.0);
        e.activations = e.activations.saturating_add(1);
        e.last_use = self.epoch;
        Some(Prediction {
            key: e.key,
            generation: e.generation,
        })
    }
    fn receipt(&mut self, prediction: Prediction, correct: bool) {
        let Some(e) = self
            .entries
            .iter_mut()
            .find(|e| e.key == prediction.key && e.generation == prediction.generation)
        else {
            self.dropped_feedback += 1;
            return;
        };
        if correct {
            e.strength = (e.strength + 0.1).min(1.0);
            e.confirmed = true;
        } else {
            e.strength = (e.strength - 0.15).max(0.0);
        }
        let fade = 2.0_f64.powf(-((self.epoch - e.last_feedback) as f64) / 128.0);
        e.benefit *= fade;
        e.evidence_mass = (e.evidence_mass as f64 * fade + 1.0) as f32;
        e.benefit += if correct { 1.0 } else { -1.0 };
        e.receipts = e.receipts.saturating_add(1);
        e.last_feedback = self.epoch;
    }
}
#[derive(Default, Clone, Serialize)]
struct Counts {
    scored: u64,
    predicted: u64,
    correct: u64,
    changed_scored: u64,
    changed_correct: u64,
}
impl Counts {
    fn accuracy(&self) -> f64 {
        self.correct as f64 / self.scored.max(1) as f64
    }
    fn changed_accuracy(&self) -> f64 {
        self.changed_correct as f64 / self.changed_scored.max(1) as f64
    }
    fn record(&mut self, prediction: Option<Prediction>, actual: u64, changed: bool) {
        let correct = prediction.is_some_and(|p| p.key.to == actual);
        self.scored += 1;
        self.predicted += u64::from(prediction.is_some());
        self.correct += u64::from(correct);
        self.changed_scored += u64::from(changed);
        self.changed_correct += u64::from(changed && correct);
    }
}
struct Pending {
    state: u64,
    context: u64,
    prediction: Option<Prediction>,
    changed: bool,
}
#[derive(Serialize)]
struct Run {
    dataset: String,
    budget: usize,
    policy: Policy,
    permuted: bool,
    counts: Counts,
    accuracy: f64,
    coverage: f64,
    conditional_accuracy: f64,
    changed_accuracy: Option<f64>,
    charged_bytes: usize,
    capacity: usize,
    peak_slots: usize,
    dropped_feedback: u64,
    evictions: u64,
    rejected: u64,
    policy_ns_per_event: f64,
    #[serde(skip)]
    cases: BTreeMap<u64, Counts>,
}
fn replay(dataset: &Dataset, policy: Policy, budget: usize, test: bool, permuted: bool) -> Run {
    let mut memory = Memory::new(policy, budget);
    let mut pending: BTreeMap<u64, Pending> = BTreeMap::new();
    let mut counts = Counts::default();
    let mut cases = BTreeMap::<u64, Counts>::new();
    let n = dataset.events.len();
    let start = n * if test { 80 } else { 60 } / 100;
    let end = if test { n } else { n * 80 / 100 };
    let mut policy_ns = 0u128;
    for (index, event) in dataset.events[..end].iter().enumerate() {
        let old = pending.remove(&event.case);
        if let Some(old) = &old {
            if index >= start {
                counts.record(old.prediction, event.state, old.changed);
                cases.entry(event.case).or_default().record(
                    old.prediction,
                    event.state,
                    old.changed,
                );
            }
        }
        let clock = Instant::now();
        memory.tick(if permuted {
            event.context.rotate_left(1)
        } else {
            event.context
        });
        if let Some(old) = &old {
            if let Some(prediction) = old.prediction {
                memory.receipt(prediction, prediction.key.to == event.state);
            }
            memory.observe(Key {
                context: old.context,
                from: old.state,
                to: event.state,
            });
            memory.observe(Key {
                context: 0,
                from: old.state,
                to: event.state,
            });
        }
        let prediction = memory.predict(event.context, event.state);
        policy_ns += clock.elapsed().as_nanos();
        let changed = old.is_some_and(|old| old.context != event.context);
        pending.insert(
            event.case,
            Pending {
                state: event.state,
                context: event.context,
                prediction,
                changed,
            },
        );
    }
    let result = Run {
        dataset: dataset.name.clone(),
        budget,
        policy,
        permuted,
        accuracy: counts.accuracy(),
        coverage: counts.predicted as f64 / counts.scored.max(1) as f64,
        conditional_accuracy: counts.correct as f64 / counts.predicted.max(1) as f64,
        changed_accuracy: (counts.changed_scored > 0).then(|| counts.changed_accuracy()),
        counts,
        charged_bytes: memory.charged_bytes(),
        capacity: memory.capacity,
        peak_slots: memory.peak_slots,
        dropped_feedback: memory.dropped_feedback,
        evictions: memory.evictions,
        rejected: memory.rejected,
        policy_ns_per_event: policy_ns as f64 / end as f64,
        cases,
    };
    assert!(result.charged_bytes <= budget);
    result
}
const BUDGETS: [usize; 3] = [2048, 4096, 8192];
fn evaluate(data: &[Dataset], policy: Policy, test: bool, permuted: bool) -> Vec<Run> {
    data.iter()
        .flat_map(|d| BUDGETS.map(|b| replay(d, policy, b, test, permuted)))
        .collect()
}
fn macro_accuracy(runs: &[Run]) -> f64 {
    runs.iter().map(|r| r.accuracy).sum::<f64>() / runs.len() as f64
}
fn bootstrap(candidate: &[Run], baseline: &[Run]) -> (f64, f64) {
    // Same case resampling weights across the three budgets; stratify by dataset.
    let mut rng = StdRng::seed_from_u64(910_2026);
    let mut distribution = Vec::new();
    for _ in 0..1000 {
        let mut difference = 0.0;
        for (a, b) in candidate.chunks(3).zip(baseline.chunks(3)) {
            let ids: Vec<_> = a[0].cases.keys().copied().collect();
            let mut numerators = [0i64; 3];
            let mut denominators = [0u64; 3];
            for _ in 0..ids.len() {
                let id = ids[rng.gen_range(0..ids.len())];
                for j in 0..3 {
                    let x = &a[j].cases[&id];
                    let y = &b[j].cases[&id];
                    assert_eq!(x.scored, y.scored);
                    numerators[j] += x.correct as i64 - y.correct as i64;
                    denominators[j] += x.scored;
                }
            }
            difference += (0..3)
                .map(|j| numerators[j] as f64 / denominators[j].max(1) as f64)
                .sum::<f64>();
        }
        distribution.push(difference / candidate.len() as f64);
    }
    distribution.sort_by(f64::total_cmp);
    (distribution[25], distribution[974])
}
fn stable(mut value: serde_json::Value) -> serde_json::Value {
    match &mut value {
        serde_json::Value::Object(map) => {
            map.remove("policy_ns_per_event");
            for item in map.values_mut() {
                *item = stable(item.take());
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                *item = stable(item.take());
            }
        }
        _ => {}
    }
    value
}
fn mechanism_probes() -> serde_json::Value {
    let mut probes = Vec::new();
    for kind in [Kind::Utility, Kind::MassUtility] {
        for correct in [true, false] {
            let mut m = Memory::new(
                Policy {
                    kind,
                    attenuation: 1.0,
                },
                2048,
            );
            m.tick(1);
            m.observe(Key {
                context: 1,
                from: 1,
                to: 2,
            });
            for n in 1..=8192 {
                m.tick(1);
                let p = m.predict(1, 1).unwrap();
                m.receipt(p, correct);
                if [128, 1024, 8192].contains(&n) {
                    probes.push(json!({"kind":kind,"correct":correct,"receipts":n,
                        "mass":m.entries[0].evidence_mass,"bonus":m.bonus(&m.entries[0])}));
                }
            }
            for _ in 0..4096 {
                m.tick(1);
            }
            probes.push(json!({"kind":kind,"correct":correct,"receipts":8192,
                "idle_events":4096,"bonus":m.bonus(&m.entries[0])}));
        }
    }
    json!(probes)
}
fn comparison(candidate: &[Run], reference: &[Run]) -> serde_json::Value {
    let delta = macro_accuracy(candidate) - macro_accuracy(reference);
    let populated: Vec<_> = candidate
        .iter()
        .zip(reference)
        .filter(|(a, _)| a.counts.changed_scored >= 100)
        .collect();
    let cells: Vec<_> = candidate
        .iter()
        .zip(reference)
        .map(|(a, b)| {
            json!({
                "dataset":a.dataset,"budget":a.budget,"accuracy_delta":a.accuracy-b.accuracy,
                "coverage_delta":a.coverage-b.coverage,
                "changed_accuracy_delta":a.changed_accuracy.zip(b.changed_accuracy).map(|(x,y)|x-y)
            })
        })
        .collect();
    let gates = json!({"macro_gain_at_least_1pp":delta>=0.01,
        "no_cell_loss_above_2pp":candidate.iter().zip(reference).all(|(a,b)|a.accuracy-b.accuracy>=-0.02),
        "changed_context_evidence_present":!populated.is_empty(),
        "no_changed_context_loss":!populated.is_empty() && populated.iter().all(|(a,b)|a.counts.changed_accuracy()>=b.counts.changed_accuracy())});
    json!({"delta":delta,"descriptive_case_bootstrap_95_percent":bootstrap(candidate,reference),
        "continuation_criteria_pass":gates.as_object().unwrap().values().all(|v|v==true),
        "criteria":gates,"cells":cells})
}
fn main() -> Result<()> {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = repo.join("experiments/evidence_mass_eval");
    let source = repo.join("experiments/context_importance_eval");
    let raw = std::fs::read(source.join("events.local.json"))?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(source.join("source_manifest.json"))?)?;
    let input_hash = format!("{:x}", Sha256::digest(&raw));
    ensure!(
        manifest["export_sha256"].as_str() == Some(&input_hash),
        "Input hash mismatch"
    );
    let data: Vec<Dataset> = serde_json::from_slice(&raw)?;
    ensure!(data.len() == 2, "Expected two pinned datasets");
    for d in &data {
        ensure!(!d.events.is_empty(), "Empty input");
        ensure!(
            d.events.iter().all(|e| e.context != 0),
            "Zero context reserved"
        );
        ensure!(
            d.events
                .windows(2)
                .all(|w| (&w[0].time, w[0].source_position) <= (&w[1].time, w[1].source_position)),
            "Nonchronological input"
        );
    }
    let policies: Vec<_> = [
        Kind::RouteDecay,
        Kind::NoDecay,
        Kind::Frequency,
        Kind::Recency,
        Kind::Utility,
        Kind::ContextUtility,
        Kind::MassUtility,
        Kind::MassContextUtility,
    ]
    .map(|kind| Policy {
        kind,
        attenuation: if matches!(kind, Kind::ContextUtility | Kind::MassContextUtility) {
            0.25
        } else {
            1.0
        },
    })
    .into_iter()
    .collect();
    let selection = json!({"protocol":"evidence-mass-v1","evaluation_status":"exploratory_reused_data",
        "parameter_search":false,"input_sha256":input_hash,"policies":policies,
        "half_life_events":128,"alpha":1,"budgets":BUDGETS});
    std::fs::write(
        root.join("configuration.json"),
        serde_json::to_vec_pretty(&selection)?,
    )?;
    let historical: serde_json::Value =
        serde_json::from_slice(&std::fs::read(source.join("results.json"))?)?;
    ensure!(
        historical["input_sha256"].as_str() == Some(&input_hash),
        "Historical input differs"
    );
    ensure!(
        historical["entry_bytes"].as_u64() == Some(size_of::<Entry>() as u64),
        "Slot size changed: no budget-matched isolation"
    );
    let mut arms = BTreeMap::<String, Vec<Run>>::new();
    for policy in policies {
        let name = serde_json::to_value(policy.kind)?
            .as_str()
            .unwrap()
            .to_owned();
        let runs = evaluate(&data, policy, true, false);
        if !matches!(policy.kind, Kind::MassUtility | Kind::MassContextUtility) {
            // Apply the same JSON text roundtrip to both sides. This serde_json
            // build can parse a decimal one ULP away from the native f64.
            let actual = stable(serde_json::from_slice(&serde_json::to_vec(&runs)?)?);
            let expected = stable(historical["arms"][&name].clone());
            if actual != expected {
                for (a, b) in actual
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(expected.as_array().unwrap())
                {
                    for (field, value) in a.as_object().unwrap() {
                        if value != &b[field] {
                            eprintln!("baseline mismatch {name}/{}/{}/{field}: actual={value}, historical={}",a["dataset"],a["budget"],b[field]);
                        }
                    }
                }
            }
            ensure!(actual == expected, "Historical baseline changed: {}", name);
        }
        println!("exploratory {}: {:.6}", name, macro_accuracy(&runs));
        arms.insert(name, runs);
    }
    let mut comparisons = BTreeMap::new();
    for (new, old) in [
        ("mass_utility", "utility"),
        ("mass_context_utility", "context_utility"),
        ("mass_utility", "route_decay"),
        ("mass_context_utility", "route_decay"),
    ] {
        let result = comparison(&arms[new], &arms[old]);
        println!(
            "{} vs {}: {:.4} pp; continuation={}",
            new,
            old,
            result["delta"].as_f64().unwrap() * 100.0,
            result["continuation_criteria_pass"]
        );
        comparisons.insert(format!("{}_vs_{}", new, old), result);
    }
    let summaries: BTreeMap<_, _> = arms
        .iter()
        .map(|(name, runs)| (name, json!({"macro_accuracy":macro_accuracy(runs)})))
        .collect();
    let result = json!({"protocol":"evidence-mass-v1","evaluation_status":"exploratory_reused_data",
        "production_promotion":false,"historical_baselines_exactly_reproduced":true,
        "input_sha256":input_hash,"entry_bytes":size_of::<Entry>(),"fixed_policy_bytes":size_of::<Memory>(),
        "incoming_scratch_bytes":size_of::<Entry>(),"budget_pass":arms.values().flatten().all(|r|r.charged_bytes<=r.budget),
        "summaries":summaries,"comparisons":comparisons,"arms":arms});
    std::fs::write(
        root.join("results.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    std::fs::write(
        root.join("diagnostics.json"),
        serde_json::to_vec_pretty(&mechanism_probes())?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn exercised(kind: Kind, n: usize, correct: bool) -> Memory {
        let mut m = Memory::new(policy(kind), 2048);
        m.observe(key(1, 2, 3));
        for _ in 0..n {
            m.tick(1);
            let p = m.predict(1, 2).unwrap();
            m.receipt(p, correct);
        }
        m
    }
    #[test]
    fn sustained_evidence_does_not_lose_influence_with_record_age() {
        for correct in [true, false] {
            let warm = exercised(Kind::MassUtility, 1024, correct);
            let old = exercised(Kind::MassUtility, 8192, correct);
            let a = warm.bonus(&warm.entries[0]);
            let b = old.bonus(&old.entries[0]);
            assert!((a - b).abs() < 0.0001);
            assert!(b.abs() > 0.68 && b.abs() < std::f64::consts::LN_2);
            assert_eq!(b.is_sign_positive(), correct);
            assert!(old.entries[0].evidence_mass < 186.0);
            let legacy = exercised(Kind::Utility, 8192, correct);
            assert!(legacy.bonus(&legacy.entries[0]).abs() < 0.03);
        }
    }
    #[test]
    fn old_evidence_loses_confidence_and_extreme_gap_resets_finitely() {
        let mut m = exercised(Kind::MassUtility, 8192, true);
        m.epoch += 4096;
        assert!(m.bonus(&m.entries[0]).abs() < 1e-6);
        m.epoch += 1_000_000;
        assert_eq!(m.bonus(&m.entries[0]), 0.0);
        let p = m.predict(1, 2).unwrap();
        m.receipt(p, false);
        assert_eq!(m.entries[0].evidence_mass, 1.0);
        assert_eq!(m.entries[0].benefit, -1.0);
        assert!((m.bonus(&m.entries[0]) + 1.5_f64.ln()).abs() < 1e-12);
    }
    #[test]
    fn contradictory_receipts_reverse_long_established_evidence() {
        let mut m = exercised(Kind::MassUtility, 8192, true);
        for _ in 0..256 {
            m.tick(1);
            let p = m.predict(1, 2).unwrap();
            m.receipt(p, false);
        }
        assert!(m.bonus(&m.entries[0]) < -0.3);
    }
    #[test]
    fn lazy_mass_and_benefit_match_explicit_epoch_discounting() {
        let mut m = Memory::new(policy(Kind::MassUtility), 2048);
        m.observe(key(1, 2, 3));
        let decay = 2.0_f64.powf(-1.0 / 128.0);
        let (mut benefit, mut mass) = (0.0, 0.0);
        for (gap, correct) in [(1, true), (17, false), (256, true), (3, false), (900, true)] {
            for _ in 0..gap {
                m.tick(1);
                benefit *= decay;
                mass *= decay;
            }
            benefit += if correct { 1.0 } else { -1.0 };
            mass += 1.0;
            let p = m.predict(1, 2).unwrap();
            m.receipt(p, correct);
            assert!((m.entries[0].benefit - benefit).abs() < 1e-10);
            assert!((m.entries[0].evidence_mass as f64 - mass).abs() < 1e-6);
        }
    }
    #[test]
    fn forgotten_generation_does_not_transfer_effective_mass() {
        let mut m = exercised(Kind::MassUtility, 100, true);
        let old = m.predict(1, 2).unwrap();
        m.entries.clear();
        m.observe(old.key);
        m.receipt(old, true);
        assert_eq!(m.entries[0].evidence_mass, 0.0);
        assert_eq!(m.entries[0].benefit, 0.0);
        assert_eq!(m.dropped_feedback, 1);
    }
    #[test]
    fn added_mass_uses_existing_padding_and_bounded_allocation() {
        assert_eq!(size_of::<Entry>(), 80);
        for kind in [Kind::MassUtility, Kind::MassContextUtility] {
            for budget in BUDGETS {
                let mut m = Memory::new(policy(kind), budget);
                let allocation = m.entries.as_ptr();
                for i in 1..1000 {
                    m.tick(i % 5 + 1);
                    m.observe(key(i % 5 + 1, i, i + 1));
                }
                assert_eq!(allocation, m.entries.as_ptr());
                assert!(m.charged_bytes() <= budget);
                assert_eq!(m.peak_slots, m.capacity);
            }
        }
    }
    fn policy(kind: Kind) -> Policy {
        Policy {
            kind,
            attenuation: 1.0,
        }
    }
    fn key(context: u64, from: u64, to: u64) -> Key {
        Key { context, from, to }
    }
    fn event(case: u64, state: u64, context: u64) -> Event {
        Event {
            case,
            state,
            context,
            time: String::new(),
            source_position: 0,
        }
    }
    #[test]
    fn surrogate_matches_sdk_working_importance_and_route_decay() {
        use aura::{Level, Record};
        for confirmed in [false, true] {
            let mut m = Memory::new(policy(Kind::RouteDecay), 2048);
            m.observe(key(1, 2, 3));
            m.entries[0].confirmed = confirmed;
            let mut record = Record::new("fixture".into(), Level::Working);
            record.salience = 0.0;
            if confirmed {
                record.tags.push("consequence-support".into());
            }
            for activations in [0, 1, 19, 20, 100] {
                m.entries[0].activations = activations;
                record.activation_count = activations;
                assert!((m.score(&m.entries[0]) - record.importance() as f64).abs() < 1e-7);
                m.tick(1);
                record.apply_route_state_decay();
                assert_eq!(m.entries[0].strength, record.strength);
            }
        }
    }
    #[test]
    fn budget_includes_capacity_and_incoming_scratch_under_pressure() {
        for budget in BUDGETS {
            let mut m = Memory::new(policy(Kind::Recency), budget);
            let allocation = m.entries.as_ptr();
            for i in 1..1000 {
                m.tick(1);
                m.observe(key(1, i, i + 1));
            }
            assert_eq!(m.entries.as_ptr(), allocation);
            assert!(m.charged_bytes() <= budget);
            assert_eq!(m.peak_slots, m.capacity);
            assert!(m.evictions > 0);
        }
    }
    #[test]
    fn delayed_receipt_cannot_credit_a_recreated_rule() {
        let mut m = Memory::new(policy(Kind::Utility), 2048);
        m.tick(1);
        m.observe(key(1, 2, 3));
        let p = m.predict(1, 2).unwrap();
        m.entries.clear();
        m.observe(p.key);
        m.receipt(p, true);
        assert_eq!(m.entries[0].receipts, 0);
        assert_eq!(m.dropped_feedback, 1);
        assert!(!m.entries[0].confirmed);
    }
    #[test]
    fn alpha_one_exactly_matches_frozen_utility() {
        let mut a = Memory::new(policy(Kind::Utility), 2048);
        let mut b = Memory::new(policy(Kind::ContextUtility), 2048);
        for i in 1..1000 {
            for m in [&mut a, &mut b] {
                m.tick(i % 7 + 1);
                m.observe(key(i % 11 + 1, i % 9, i % 13));
                if let Some(p) = m.predict(i % 7 + 1, i % 9) {
                    m.receipt(p, i % 3 != 0);
                }
            }
            assert_eq!(
                a.entries
                    .iter()
                    .map(|e| (e.key, a.score(e)))
                    .collect::<Vec<_>>(),
                b.entries
                    .iter()
                    .map(|e| (e.key, b.score(e)))
                    .collect::<Vec<_>>()
            );
        }
    }
    #[test]
    fn wrong_importance_context_does_not_change_lookup_or_receipt_target() {
        let mut m = Memory::new(
            Policy {
                kind: Kind::ContextUtility,
                attenuation: 0.0,
            },
            2048,
        );
        m.tick(16);
        m.observe(key(8, 2, 3));
        m.observe(key(16, 2, 4));
        let p = m.predict(8, 2).unwrap();
        assert_eq!(p.key.to, 3);
        m.receipt(p, true);
        assert_eq!(
            m.entries
                .iter()
                .find(|e| e.key.context == 8)
                .unwrap()
                .receipts,
            1
        );
        assert_eq!(
            m.entries
                .iter()
                .find(|e| e.key.context == 16)
                .unwrap()
                .receipts,
            0
        );
    }
    #[test]
    fn interleaved_cases_have_no_future_training_or_invented_terminal_outcomes() {
        // Two late first-ever cases: no prior transition from either current state.
        let d = Dataset {
            name: "fixture".into(),
            events: vec![
                event(1, 1, 10),
                event(1, 2, 10),
                event(1, 3, 10),
                event(1, 4, 10),
                event(1, 5, 10),
                event(1, 6, 10),
                event(2, 100, 10),
                event(3, 200, 20),
                event(2, 101, 10),
                event(3, 201, 20),
            ],
        };
        let r = replay(&d, policy(Kind::Utility), 2048, true, false);
        assert_eq!(r.counts.scored, 2);
        assert_eq!(r.counts.predicted, 0);
        assert_eq!(r.cases.len(), 2);
    }
    #[test]
    fn changed_subset_scores_prediction_after_change_and_split_uses_arrival() {
        let d = Dataset {
            name: "fixture".into(),
            events: vec![
                event(1, 1, 10),
                event(1, 2, 10),
                event(1, 1, 10),
                event(1, 2, 10),
                event(1, 1, 10),
                event(1, 2, 10),
                event(1, 1, 10),
                event(1, 2, 20),
                event(1, 1, 20),
                event(1, 2, 20),
            ],
        };
        let val = replay(&d, policy(Kind::Utility), 2048, false, false);
        let test = replay(&d, policy(Kind::Utility), 2048, true, false);
        assert_eq!(val.counts.scored, 2);
        assert_eq!(val.counts.changed_scored, 0);
        assert_eq!(test.counts.scored, 2);
        assert_eq!(test.counts.changed_scored, 1);
    }
}
