//! Retention-only experiment; see experiments/cognitive_importance_eval/PROTOCOL.md.
use anyhow::Result;
use aura::{Level, Record};
use rand::{rngs::StdRng, seq::SliceRandom, Rng, SeedableRng};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::time::Instant;

#[derive(Clone)]
enum Event {
    Tick(u64),
    Ingest(Box<Record>),
    Expose(String, Option<f64>),
    Task {
        ids: Vec<String>,
        cost: f64,
        rare: bool,
        measured: bool,
    },
}

#[derive(Clone, Copy, Debug, Serialize)]
struct Policy {
    kind: &'static str,
    alpha: f64,
    half_life: f64,
}

fn baselines() -> Vec<Policy> {
    ["route_decay", "no_decay", "frequency", "recency"]
        .into_iter()
        .map(|kind| Policy {
            kind,
            alpha: 0.0,
            half_life: 32.0,
        })
        .collect()
}

#[derive(Clone, Serialize)]
struct Entry {
    record: Record,
    benefit: f64,
    receipts: u32,
    last_feedback: u64,
    last_use: u64,
    #[serde(skip)]
    bytes: usize,
}

impl Entry {
    fn size(&mut self) {
        self.bytes = serde_json::to_vec(self).unwrap().len();
    }
    fn touch(&mut self, epoch: u64) {
        self.record.activate();
        // Wall-clock/velocity are not selection features; normalize them so
        // repeated runs have identical representation budgets and ordering.
        self.record.last_activated = epoch as f64;
        self.record.activation_velocity = 0.0;
        self.last_use = epoch;
    }
}

struct Memory {
    entries: BTreeMap<String, Entry>,
    policy: Policy,
    epoch: u64,
    budget: usize,
    peak: usize,
    deleted: usize,
    shuffled: bool,
    no_feedback: bool,
}

impl Memory {
    fn new(policy: Policy, budget: usize, shuffled: bool, no_feedback: bool) -> Self {
        Self {
            entries: BTreeMap::new(),
            policy,
            epoch: 0,
            budget,
            peak: 0,
            deleted: 0,
            shuffled,
            no_feedback,
        }
    }
    fn score(&self, e: &Entry) -> f64 {
        let base = e.record.importance() as f64;
        let value = match self.policy.kind {
            "frequency" => 1.0 + e.record.activation_count as f64,
            "recency" => 1.0 / (1.0 + self.epoch.saturating_sub(e.last_use) as f64),
            "utility" => {
                let mean = e.benefit / (1.0 + e.receipts as f64);
                let age = self.epoch.saturating_sub(e.last_feedback) as f64;
                base + self.policy.alpha
                    * mean.signum()
                    * mean.abs().ln_1p()
                    * 2.0_f64.powf(-age / self.policy.half_life)
            }
            _ => base,
        };
        value / e.bytes.max(1) as f64
    }
    fn enforce(&mut self) {
        let mut bytes: usize = self.entries.values().map(|e| e.bytes).sum();
        while bytes > self.budget {
            let id = self
                .entries
                .iter()
                .min_by(|(ia, a), (ib, b)| {
                    self.score(a)
                        .total_cmp(&self.score(b))
                        .then_with(|| ia.cmp(ib))
                })
                .map(|(id, _)| id.clone())
                .unwrap();
            bytes -= self.entries.remove(&id).unwrap().bytes;
            self.deleted += 1;
        }
        self.peak = self.peak.max(bytes);
        assert!(bytes <= self.budget);
    }
    fn ingest(&mut self, record: &Record) {
        // Re-observation may restore a forgotten record. It does not reset
        // evidence/strength for a record still retained.
        if !self.entries.contains_key(&record.id) {
            let mut entry = Entry {
                record: record.clone(),
                benefit: 0.0,
                receipts: 0,
                last_feedback: self.epoch,
                last_use: self.epoch,
                bytes: 0,
            };
            entry.size();
            self.entries.insert(record.id.clone(), entry);
        }
        self.enforce();
    }
    fn receipt(&mut self, id: &str, benefit: f64) {
        if self.no_feedback {
            return;
        }
        if let Some(e) = self.entries.get_mut(id) {
            // Keep the existing strength/tag effects correctly attributed,
            // including in the shuffled control. Only the added signal moves.
            if benefit > 0.0 {
                e.record.strength = (e.record.strength + 0.1).min(1.0);
                if !e.record.tags.iter().any(|t| t == "consequence-support") {
                    e.record.tags.push("consequence-support".into());
                }
            } else {
                e.record.strength = (e.record.strength - 0.15).max(0.0);
            }
            e.size();
        }
        let target = if self.shuffled && self.entries.len() > 1 {
            // Deterministic wrong-recipient control: preserve receipt values
            // and timing, rotate attribution among retained IDs.
            let ids: Vec<_> = self.entries.keys().cloned().collect();
            let pos = ids.iter().position(|key| key == id).unwrap_or(0);
            ids[(pos + 1) % ids.len()].clone()
        } else {
            id.to_string()
        };
        if let Some(e) = self.entries.get_mut(&target) {
            // Epoch-normalized historical outcome value; no forgotten-ID table.
            e.benefit *= 2.0_f64
                .powf(-(self.epoch.saturating_sub(e.last_feedback) as f64) / self.policy.half_life);
            e.benefit += benefit;
            e.receipts = e.receipts.saturating_add(1);
            e.last_feedback = self.epoch;
            e.size();
        }
    }
    fn expose(&mut self, id: &str, feedback: Option<f64>) {
        if let Some(e) = self.entries.get_mut(id) {
            e.touch(self.epoch);
            e.size();
            if let Some(value) = feedback {
                self.receipt(id, value);
            }
        }
        self.enforce();
    }
    fn tick(&mut self, epoch: u64) {
        assert!(epoch >= self.epoch);
        let elapsed = epoch - self.epoch;
        self.epoch = epoch;
        if self.policy.kind == "route_decay" {
            for _ in 0..elapsed {
                for e in self.entries.values_mut() {
                    e.record.apply_route_state_decay();
                }
            }
            let before = self.entries.len();
            self.entries.retain(|_, e| e.record.is_alive());
            self.deleted += before - self.entries.len();
            for e in self.entries.values_mut() {
                e.size();
            }
        }
        self.enforce();
    }
}

const CASES: [&str; 5] = [
    "stationary",
    "frequent_noise",
    "rare_delayed",
    "context_shift",
    "noisy_feedback",
];
const BUDGETS: [usize; 3] = [12 * 1024, 24 * 1024, 36 * 1024];

fn fixture(_id: usize, rng: &mut StdRng) -> Record {
    let mut record = Record::new(
        format!(
            "Opaque evidence {:08x} {}",
            rng.gen::<u32>(),
            "x".repeat(rng.gen_range(40..650))
        ),
        Level::Working,
    );
    // Randomized opaque IDs prevent tie-breaks from encoding hidden roles.
    record.id = format!("e{:016x}", rng.gen::<u64>());
    record.created_at = 0.0;
    record.last_activated = 0.0;
    record.namespace = "experiment".into();
    record
}

fn trace(seed: u64, case: usize) -> Vec<Event> {
    let mut rng = StdRng::seed_from_u64(seed * 101 + case as u64);
    let pool: Vec<_> = (0..48).map(|id| fixture(id, &mut rng)).collect();
    let mut events = Vec::new();
    let mut order: Vec<_> = (0..48).collect();
    order.shuffle(&mut rng);
    for id in order {
        events.push(Event::Ingest(Box::new(pool[id].clone())));
        if id < 28 {
            events.push(Event::Task {
                ids: vec![pool[id].id.clone()],
                cost: if id < 4 { 12.0 } else { 1.0 },
                rare: id < 4,
                measured: false,
            });
        }
    }
    let mut recent = Vec::new();
    for epoch in 1..=240 {
        events.push(Event::Tick(epoch));
        if epoch % 3 == 0 {
            let r = fixture(48 + epoch as usize, &mut rng);
            recent.push(r.id.clone());
            if recent.len() > 8 {
                recent.remove(0);
            }
            events.push(Event::Ingest(Box::new(r)));
        }
        if epoch % 7 == 0 {
            let id = rng.gen_range(28..48);
            events.push(Event::Ingest(Box::new(pool[id].clone())));
        }
        let noise = if case == 1 { 6 } else { 2 };
        for _ in 0..noise {
            let id = rng.gen_range(28..48);
            let feedback = if rng.gen_bool(0.4) {
                Some(if case == 4 && rng.gen_bool(0.2) {
                    1.0
                } else {
                    -1.0
                })
            } else {
                None
            };
            events.push(Event::Expose(pool[id].id.clone(), feedback));
        }
        let rare = if case == 2 {
            epoch > 140 && epoch % 11 == 0
        } else {
            epoch % 29 == 0
        };
        let ids = if rare {
            vec![pool[rng.gen_range(0..4)].id.clone()]
        } else if !recent.is_empty() && rng.gen_bool(0.3) {
            vec![recent[rng.gen_range(0..recent.len())].clone()]
        } else {
            let range = if case == 3 && epoch > 120 {
                20..28
            } else {
                4..20
            };
            let id = rng.gen_range(range.clone());
            let mut ids = vec![pool[id].id.clone()];
            if rng.gen_bool(0.2) {
                let other = rng.gen_range(range);
                if other != id {
                    ids.push(pool[other].id.clone());
                }
            }
            ids
        };
        events.push(Event::Task {
            ids,
            cost: if rare { 12.0 } else { 1.0 },
            rare,
            measured: true,
        });
    }
    events
}

#[derive(Clone, Serialize)]
struct Metric {
    seed: u64,
    case: &'static str,
    budget: usize,
    tasks: usize,
    successful: usize,
    cost: f64,
    avoided: f64,
    rare_tasks: usize,
    rare_successful: usize,
    peak_retained_bytes: usize,
    final_records: usize,
    final_noise_records: usize,
    deleted: usize,
    policy_ms: f64,
}

fn replay(
    events: &[Event],
    policy: Policy,
    budget: usize,
    seed: u64,
    case: &'static str,
    shuffled: bool,
    no_feedback: bool,
) -> Metric {
    let mut memory = Memory::new(policy, budget, shuffled, no_feedback);
    let mut m = Metric {
        seed,
        case,
        budget,
        tasks: 0,
        successful: 0,
        cost: 0.0,
        avoided: 0.0,
        rare_tasks: 0,
        rare_successful: 0,
        peak_retained_bytes: 0,
        final_records: 0,
        final_noise_records: 0,
        deleted: 0,
        policy_ms: 0.0,
    };
    for event in events {
        match event {
            Event::Task {
                ids,
                cost,
                rare,
                measured,
            } => {
                // Oracle task evaluation stays outside the policy and timing.
                let success = ids.iter().all(|id| memory.entries.contains_key(id));
                if *measured {
                    m.tasks += 1;
                    m.cost += cost;
                    if success {
                        m.successful += 1;
                        m.avoided += cost;
                    }
                    if *rare {
                        m.rare_tasks += 1;
                        if success {
                            m.rare_successful += 1;
                        }
                    }
                }
                let start = Instant::now();
                for id in ids {
                    memory.expose(id, None);
                    if success {
                        memory.receipt(id, cost / ids.len() as f64);
                    }
                }
                memory.enforce();
                m.policy_ms += start.elapsed().as_secs_f64() * 1000.0;
            }
            _ => {
                let start = Instant::now();
                match event {
                    Event::Tick(epoch) => memory.tick(*epoch),
                    Event::Ingest(r) => memory.ingest(r),
                    Event::Expose(id, feedback) => memory.expose(id, *feedback),
                    _ => unreachable!(),
                }
                m.policy_ms += start.elapsed().as_secs_f64() * 1000.0;
            }
        }
    }
    m.peak_retained_bytes = memory.peak;
    m.final_records = memory.entries.len();
    let exposed: std::collections::BTreeSet<_> = events
        .iter()
        .filter_map(|event| {
            if let Event::Expose(id, _) = event {
                Some(id)
            } else {
                None
            }
        })
        .collect();
    m.final_noise_records = exposed
        .iter()
        .filter(|id| memory.entries.contains_key(**id))
        .count();
    m.deleted = memory.deleted;
    m
}

fn evaluate(
    policy: Policy,
    seeds: std::ops::Range<u64>,
    shuffled: bool,
    no_feedback: bool,
) -> Vec<Metric> {
    let mut rows = Vec::new();
    for seed in seeds {
        for (case, name) in CASES.iter().enumerate() {
            let events = trace(seed, case);
            for budget in BUDGETS {
                rows.push(replay(
                    &events,
                    policy,
                    budget,
                    seed,
                    name,
                    shuffled,
                    no_feedback,
                ));
            }
        }
    }
    rows
}
fn weighted(rows: &[Metric]) -> f64 {
    rows.iter().map(|m| m.avoided).sum::<f64>() / rows.iter().map(|m| m.cost).sum::<f64>()
}
fn summary(rows: &[Metric]) -> serde_json::Value {
    let mut times: Vec<_> = rows.iter().map(|r| r.policy_ms / r.tasks as f64).collect();
    times.sort_by(f64::total_cmp);
    json!({"weighted_success":weighted(rows),
        "task_success":rows.iter().map(|r|r.successful).sum::<usize>() as f64/rows.iter().map(|r|r.tasks).sum::<usize>() as f64,
        "rare_task_success":rows.iter().map(|r|r.rare_successful).sum::<usize>() as f64/rows.iter().map(|r|r.rare_tasks).sum::<usize>() as f64,
        "mean_final_noise_records":rows.iter().map(|r|r.final_noise_records).sum::<usize>() as f64/rows.len() as f64,
        "median_policy_ms_per_task_epoch":times[times.len()/2],
        "p95_trace_mean_policy_ms_per_task_epoch":times[(times.len()*95/100).min(times.len()-1)],
        "budget_respected":rows.iter().all(|r|r.peak_retained_bytes<=r.budget)})
}

fn main() -> Result<()> {
    let mut candidates = Vec::new();
    for alpha in [0.0, 0.25, 0.5, 1.0, 2.0] {
        for half_life in [8.0, 32.0, 128.0] {
            let p = Policy {
                kind: "utility",
                alpha,
                half_life,
            };
            candidates.push((p, weighted(&evaluate(p, 100..104, false, false))));
        }
    }
    candidates.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.alpha.total_cmp(&b.0.alpha))
            .then_with(|| a.0.half_life.total_cmp(&b.0.half_life))
    });
    let mut shortlist: Vec<_> = candidates
        .iter()
        .take(3)
        .map(|(p, train)| (*p, *train, weighted(&evaluate(*p, 200..204, false, false))))
        .collect();
    shortlist.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then_with(|| a.0.alpha.total_cmp(&b.0.alpha))
    });
    let chosen = shortlist[0].0;
    let mut controls: Vec<_> = baselines()
        .into_iter()
        .map(|p| (p, weighted(&evaluate(p, 200..204, false, false))))
        .collect();
    controls.sort_by(|a, b| b.1.total_cmp(&a.1));
    let control = controls[0].0;
    // Selection is complete before the first test trace is generated.
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("experiments/cognitive_importance_eval");
    let selection = json!({"chosen":chosen,"validation_baseline":control,
        "training_grid":candidates,"validation_shortlist":shortlist,"baseline_validation":controls});
    std::fs::write(
        directory.join("selection.json"),
        serde_json::to_vec_pretty(&selection)?,
    )?;
    let mut arms = BTreeMap::new();
    for p in baselines() {
        arms.insert(p.kind.to_string(), evaluate(p, 300..312, false, false));
    }
    arms.insert("utility".into(), evaluate(chosen, 300..312, false, false));
    arms.insert(
        "utility_shuffled".into(),
        evaluate(chosen, 300..312, true, false),
    );
    arms.insert(
        "utility_no_feedback".into(),
        evaluate(chosen, 300..312, false, true),
    );
    let u = &arms["utility"];
    let b = &arms[control.kind];
    let mut cells = Vec::new();
    for case in CASES {
        for budget in BUDGETS {
            let ur: Vec<_> = u
                .iter()
                .filter(|m| m.case == case && m.budget == budget)
                .cloned()
                .collect();
            let br: Vec<_> = b
                .iter()
                .filter(|m| m.case == case && m.budget == budget)
                .cloned()
                .collect();
            cells.push(json!({"case":case,"budget":budget,"utility":weighted(&ur),
            "baseline":weighted(&br),"delta":weighted(&ur)-weighted(&br)}));
        }
    }
    let mut rng = StdRng::seed_from_u64(9237);
    let mut bootstrap = Vec::new();
    for _ in 0..2000 {
        let mut ua = 0.0;
        let mut ba = 0.0;
        let mut cost = 0.0;
        for _ in 0..12 {
            let seed = rng.gen_range(300..312);
            ua += u
                .iter()
                .filter(|m| m.seed == seed)
                .map(|m| m.avoided)
                .sum::<f64>();
            ba += b
                .iter()
                .filter(|m| m.seed == seed)
                .map(|m| m.avoided)
                .sum::<f64>();
            cost += u
                .iter()
                .filter(|m| m.seed == seed)
                .map(|m| m.cost)
                .sum::<f64>();
        }
        bootstrap.push((ua - ba) / cost);
    }
    bootstrap.sort_by(f64::total_cmp);
    let delta = weighted(u) - weighted(b);
    let worst = cells
        .iter()
        .map(|v| v["delta"].as_f64().unwrap())
        .fold(f64::INFINITY, f64::min);
    let budgets = arms
        .values()
        .flatten()
        .all(|r| r.peak_retained_bytes <= r.budget);
    let informative = weighted(u) > weighted(&arms["utility_shuffled"]);
    let passed = budgets && delta >= 0.01 && bootstrap[50] > 0.0 && worst >= -0.02 && informative;
    let summaries: BTreeMap<_, _> = arms
        .iter()
        .map(|(name, rows)| (name.clone(), summary(rows)))
        .collect();
    let result = json!({"protocol":"cognitive-importance-v1","selection":selection,
        "test_seeds":[300,311],"traces_per_arm":u.len(),"summaries":summaries,"cells":cells,
        "gate":{"passed":passed,"budget_respected":budgets,"weighted_delta":delta,
            "paired_seed_bootstrap_95":[bootstrap[50],bootstrap[1950]],"worst_cell_delta":worst,
            "receipt_negative_control_degrades":informative},"rows":arms});
    std::fs::write(
        directory.join("results.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"selected":chosen,"baseline":control,
        "summaries":summaries,"gate":result["gate"]}))?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budget_includes_feedback_and_rejects_oversized_record() {
        let mut rng = StdRng::seed_from_u64(1);
        let p = Policy {
            kind: "utility",
            alpha: 1.0,
            half_life: 32.0,
        };
        let mut m = Memory::new(p, 2048, false, false);
        for id in 0..20 {
            let r = fixture(id, &mut rng);
            m.ingest(&r);
            m.expose(&r.id, Some(12.0));
            assert!(m.entries.values().map(|e| e.bytes).sum::<usize>() <= 2048);
        }
        let mut huge = fixture(100, &mut rng);
        huge.content = "x".repeat(4096);
        m.ingest(&huge);
        assert!(!m.entries.contains_key(&huge.id));
    }
    #[test]
    fn zero_utility_weight_matches_no_decay_with_same_feedback_horizon() {
        let events = trace(999, 1);
        let p = Policy {
            kind: "utility",
            alpha: 0.0,
            half_life: 32.0,
        };
        let a = replay(&events, p, 12288, 999, "test", false, false);
        let b = replay(
            &events,
            Policy {
                kind: "no_decay",
                ..p
            },
            12288,
            999,
            "test",
            false,
            false,
        );
        assert_eq!(a.avoided, b.avoided);
        assert_eq!(a.deleted, b.deleted);
    }
    #[test]
    fn forgotten_record_cannot_receive_credit_or_reappear_without_ingestion() {
        let p = Policy {
            kind: "utility",
            alpha: 1.0,
            half_life: 32.0,
        };
        let mut m = Memory::new(p, 0, false, false);
        let r = fixture(0, &mut StdRng::seed_from_u64(1));
        m.ingest(&r);
        m.receipt(&r.id, 100.0);
        m.expose(&r.id, Some(100.0));
        m.tick(2);
        assert!(m.entries.is_empty());
    }

    #[test]
    fn shuffled_control_preserves_existing_feedback_effects() {
        let p = Policy {
            kind: "utility",
            alpha: 1.0,
            half_life: 32.0,
        };
        let mut rng = StdRng::seed_from_u64(74);
        let first = fixture(0, &mut rng);
        let second = fixture(1, &mut rng);
        let mut normal = Memory::new(p, 8192, false, false);
        let mut shuffled = Memory::new(p, 8192, true, false);
        for memory in [&mut normal, &mut shuffled] {
            memory.ingest(&first);
            memory.ingest(&second);
            memory.entries.get_mut(&first.id).unwrap().record.strength = 0.5;
            memory.receipt(&first.id, 12.0);
        }
        assert_eq!(
            normal.entries[&first.id].record.strength,
            shuffled.entries[&first.id].record.strength
        );
        assert_eq!(
            normal.entries[&first.id].record.tags,
            shuffled.entries[&first.id].record.tags
        );
        assert_eq!(normal.entries[&first.id].benefit, 12.0);
        assert_eq!(shuffled.entries[&first.id].benefit, 0.0);
        assert_eq!(shuffled.entries[&second.id].benefit, 12.0);
    }

    #[test]
    fn seeded_replay_is_deterministic() {
        let p = Policy {
            kind: "utility",
            alpha: 1.0,
            half_life: 32.0,
        };
        let events = trace(982, 2);
        let mut a = replay(&events, p, 12288, 982, "test", false, false);
        let mut b = replay(&trace(982, 2), p, 12288, 982, "test", false, false);
        a.policy_ms = 0.0;
        b.policy_ms = 0.0;
        assert_eq!(
            serde_json::to_value(a).unwrap(),
            serde_json::to_value(b).unwrap()
        );
    }
}
