//! Standalone experiment for context-aware experiential recall.
//!
//! This intentionally lives outside Aura's public API. It compares ordinary
//! semantic recall with a small, deterministic applicability gate over
//! structured preconditions stored in record metadata.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{ensure, Context, Result};
use aura::{
    evaluate_applicability, ApplicabilityContext, ApplicabilityDecision, Aura, Level, Record,
    APPLICABILITY_REQUIRE_PREFIX,
};

struct ExperiencePair {
    namespace: &'static str,
    query: &'static str,
    first_cause: &'static str,
    first_action: &'static str,
    second_cause: &'static str,
    second_action: &'static str,
}

struct ExperimentResult {
    cases: usize,
    baseline_correct: usize,
    gated_correct: usize,
    baseline_candidates: usize,
    baseline_inapplicable: usize,
    gated_candidates: usize,
    gated_inapplicable: usize,
    gate_time: Duration,
}

#[derive(Default)]
struct RobustnessResult {
    cases: usize,
    correct_decisions: usize,
    expected_use: usize,
    expected_reject: usize,
    expected_unknown: usize,
    actual_use: usize,
    actual_reject: usize,
    actual_unknown: usize,
    baseline_unsafe_auto_use: usize,
    gated_unsafe_auto_use: usize,
    gate_time: Duration,
}

impl ExperimentResult {
    fn percent(part: usize, total: usize) -> f64 {
        if total == 0 {
            0.0
        } else {
            part as f64 * 100.0 / total as f64
        }
    }

    fn print(&self) {
        println!("Aura context-applicability experiment");
        println!("=====================================");
        println!("Counterfactual cases: {}", self.cases);
        println!(
            "Baseline top-1 accuracy: {:.1}% ({}/{})",
            Self::percent(self.baseline_correct, self.cases),
            self.baseline_correct,
            self.cases
        );
        println!(
            "Gated top-1 accuracy:    {:.1}% ({}/{})",
            Self::percent(self.gated_correct, self.cases),
            self.gated_correct,
            self.cases
        );
        println!(
            "Baseline unsafe exposure: {:.1}% ({}/{})",
            Self::percent(self.baseline_inapplicable, self.baseline_candidates),
            self.baseline_inapplicable,
            self.baseline_candidates
        );
        println!(
            "Gated unsafe exposure:    {:.1}% ({}/{})",
            Self::percent(self.gated_inapplicable, self.gated_candidates),
            self.gated_inapplicable,
            self.gated_candidates
        );
        println!(
            "Applicability gate time:  {:.2} us/case",
            self.gate_time.as_secs_f64() * 1_000_000.0 / self.cases as f64
        );
    }
}

fn pairs() -> [ExperiencePair; 10] {
    [
        ExperiencePair {
            namespace: "experiment-auth",
            query: "deployment authentication failure recovery",
            first_cause: "expired_token",
            first_action: "refresh the expired token and retry deployment",
            second_cause: "permission_denied",
            second_action: "request access approval before retrying deployment",
        },
        ExperiencePair {
            namespace: "experiment-build",
            query: "software build failure recovery",
            first_cause: "dependency_conflict",
            first_action: "align dependency versions and rebuild",
            second_cause: "missing_file",
            second_action: "restore the missing source file and rebuild",
        },
        ExperiencePair {
            namespace: "experiment-browser",
            query: "browser page access failure recovery",
            first_cause: "page_loading",
            first_action: "wait for page readiness before interacting",
            second_cause: "policy_blocked",
            second_action: "stop and request authorization for the blocked page",
        },
        ExperiencePair {
            namespace: "experiment-database",
            query: "database operation failure recovery",
            first_cause: "connection_timeout",
            first_action: "retry with bounded connection backoff",
            second_cause: "schema_mismatch",
            second_action: "apply the compatible schema migration",
        },
        ExperiencePair {
            namespace: "experiment-api",
            query: "api request failure recovery",
            first_cause: "rate_limited",
            first_action: "respect retry-after and reduce request rate",
            second_cause: "invalid_payload",
            second_action: "correct the request payload before retrying",
        },
        ExperiencePair {
            namespace: "experiment-deploy",
            query: "service deployment unhealthy recovery",
            first_cause: "readiness_probe",
            first_action: "fix the readiness probe configuration",
            second_cause: "quota_exceeded",
            second_action: "request capacity or reduce resource allocation",
        },
        ExperiencePair {
            namespace: "experiment-storage",
            query: "file write failure recovery",
            first_cause: "permission_denied",
            first_action: "request write permission for the target",
            second_cause: "disk_full",
            second_action: "free storage capacity before writing again",
        },
        ExperiencePair {
            namespace: "experiment-checkout",
            query: "shopping checkout failure recovery",
            first_cause: "payment_declined",
            first_action: "ask for a valid payment method",
            second_cause: "inventory_unavailable",
            second_action: "select an available replacement item",
        },
        ExperiencePair {
            namespace: "experiment-network",
            query: "network request failure recovery",
            first_cause: "transient_timeout",
            first_action: "retry with capped exponential backoff",
            second_cause: "certificate_invalid",
            second_action: "stop and repair certificate trust",
        },
        ExperiencePair {
            namespace: "experiment-tests",
            query: "automated test failure recovery",
            first_cause: "timing_flake",
            first_action: "replace fixed sleeps with readiness synchronization",
            second_cause: "assertion_regression",
            second_action: "fix the behavior that violates the assertion",
        },
    ]
}

fn store_experience(
    aura: &Aura,
    pair: &ExperiencePair,
    cause: &str,
    action: &str,
) -> Result<Record> {
    let mut metadata = HashMap::new();
    metadata.insert(
        format!("{APPLICABILITY_REQUIRE_PREFIX}cause"),
        cause.to_string(),
    );
    metadata.insert(
        format!("{APPLICABILITY_REQUIRE_PREFIX}environment"),
        "ready".into(),
    );
    metadata.insert("experience.action".into(), action.to_string());
    metadata.insert("experience.source_context".into(), cause.to_string());

    aura.store(
        &format!("Experience for {}: {action}", pair.query),
        Some(Level::Decisions),
        Some(vec!["experience".into(), "applicability-experiment".into()]),
        None,
        Some("text/plain"),
        Some("recorded"),
        Some(metadata),
        Some(false),
        None,
        Some(pair.namespace),
        Some("decision"),
    )
}

fn state(fields: &[(&str, &[&str])]) -> ApplicabilityContext {
    fields
        .iter()
        .map(|(field, values)| {
            (
                (*field).to_string(),
                values.iter().map(|value| (*value).to_string()).collect(),
            )
        })
        .collect()
}

fn expected(record: &Record, cause: &str) -> bool {
    record
        .metadata
        .get(&format!("{APPLICABILITY_REQUIRE_PREFIX}cause"))
        .is_some_and(|value| value == cause)
}

fn record_robustness_probe(
    result: &mut RobustnessResult,
    record: &Record,
    current_state: &ApplicabilityContext,
    expected: ApplicabilityDecision,
) {
    let started = Instant::now();
    let actual = evaluate_applicability(record, current_state).decision;
    result.gate_time += started.elapsed();
    result.cases += 1;
    result.correct_decisions += usize::from(actual == expected);

    match expected {
        ApplicabilityDecision::Use => result.expected_use += 1,
        ApplicabilityDecision::Reject => result.expected_reject += 1,
        ApplicabilityDecision::Unknown => result.expected_unknown += 1,
    }
    match actual {
        ApplicabilityDecision::Use => result.actual_use += 1,
        ApplicabilityDecision::Reject => result.actual_reject += 1,
        ApplicabilityDecision::Unknown => result.actual_unknown += 1,
    }

    // Ordinary recall exposes every retrieved candidate as usable. Anything
    // other than a proven match is unsafe to apply automatically.
    result.baseline_unsafe_auto_use += usize::from(expected != ApplicabilityDecision::Use);
    result.gated_unsafe_auto_use +=
        usize::from(actual == ApplicabilityDecision::Use && expected != ApplicabilityDecision::Use);
}

fn run_robustness_experiment(aura: &Aura, pairs: &[ExperiencePair]) -> Result<RobustnessResult> {
    let mut result = RobustnessResult::default();
    for pair in pairs {
        let rows = aura.recall_structured(
            pair.query,
            Some(2),
            Some(0.0),
            Some(false),
            None,
            Some(&[pair.namespace]),
        )?;
        ensure!(rows.len() == 2, "both paired experiences must be recalled");

        for (_, record) in rows {
            let record_cause = record
                .metadata
                .get(&format!("{APPLICABILITY_REQUIRE_PREFIX}cause"))
                .context("probe experience must declare its cause")?;
            let other_cause = if record_cause == pair.first_cause {
                pair.second_cause
            } else {
                pair.first_cause
            };

            record_robustness_probe(
                &mut result,
                &record,
                &state(&[("cause", &[record_cause]), ("environment", &["ready"])]),
                ApplicabilityDecision::Use,
            );
            record_robustness_probe(
                &mut result,
                &record,
                &state(&[("cause", &[other_cause]), ("environment", &["ready"])]),
                ApplicabilityDecision::Reject,
            );
            record_robustness_probe(
                &mut result,
                &record,
                &state(&[("cause", &[record_cause])]),
                ApplicabilityDecision::Unknown,
            );
            record_robustness_probe(
                &mut result,
                &record,
                &state(&[
                    ("cause", &[record_cause]),
                    ("environment", &["ready", "blocked"]),
                ]),
                ApplicabilityDecision::Unknown,
            );

            let mut unstructured = record.clone();
            unstructured
                .metadata
                .retain(|key, _| !key.starts_with(APPLICABILITY_REQUIRE_PREFIX));
            record_robustness_probe(
                &mut result,
                &unstructured,
                &state(&[("cause", &[record_cause]), ("environment", &["ready"])]),
                ApplicabilityDecision::Unknown,
            );
        }
    }
    Ok(result)
}

fn print_robustness(result: &RobustnessResult) {
    println!();
    println!("Incomplete/conflicting context robustness");
    println!("=========================================\n");
    println!("Robustness probes: {}", result.cases);
    println!(
        "Decision accuracy: {:.1}% ({}/{})",
        ExperimentResult::percent(result.correct_decisions, result.cases),
        result.correct_decisions,
        result.cases
    );
    println!(
        "Expected USE / REJECT / UNKNOWN: {} / {} / {}",
        result.expected_use, result.expected_reject, result.expected_unknown
    );
    println!(
        "Actual USE / REJECT / UNKNOWN:   {} / {} / {}",
        result.actual_use, result.actual_reject, result.actual_unknown
    );
    println!(
        "Baseline unsafe auto-use: {:.1}% ({}/{})",
        ExperimentResult::percent(result.baseline_unsafe_auto_use, result.cases),
        result.baseline_unsafe_auto_use,
        result.cases
    );
    println!(
        "Gated unsafe auto-use:    {:.1}% ({}/{})",
        ExperimentResult::percent(result.gated_unsafe_auto_use, result.cases),
        result.gated_unsafe_auto_use,
        result.cases
    );
    println!(
        "Robustness gate time:     {:.2} us/probe",
        result.gate_time.as_secs_f64() * 1_000_000.0 / result.cases as f64
    );
}

fn main() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let aura = Aura::open(
        directory
            .path()
            .to_str()
            .context("temporary path must be valid UTF-8")?,
    )?;

    let pairs = pairs();
    for pair in &pairs {
        store_experience(&aura, pair, pair.first_cause, pair.first_action)?;
        store_experience(&aura, pair, pair.second_cause, pair.second_action)?;
    }

    let mut result = ExperimentResult {
        cases: 0,
        baseline_correct: 0,
        gated_correct: 0,
        baseline_candidates: 0,
        baseline_inapplicable: 0,
        gated_candidates: 0,
        gated_inapplicable: 0,
        gate_time: Duration::ZERO,
    };

    // Every pair is evaluated twice with the same query and opposite current
    // conditions. Ordinary recall cannot distinguish the counterfactuals;
    // the applicability gate can because the caller supplies current state.
    for pair in &pairs {
        for current_cause in [pair.first_cause, pair.second_cause] {
            let rows = aura.recall_structured(
                pair.query,
                Some(2),
                Some(0.0),
                Some(false),
                None,
                Some(&[pair.namespace]),
            )?;
            ensure!(rows.len() == 2, "both paired experiences must be recalled");

            result.cases += 1;
            result.baseline_candidates += rows.len();
            if expected(&rows[0].1, current_cause) {
                result.baseline_correct += 1;
            }

            let current_state = state(&[("cause", &[current_cause]), ("environment", &["ready"])]);
            result.baseline_inapplicable += rows
                .iter()
                .filter(|(_, record)| {
                    evaluate_applicability(record, &current_state).decision
                        != ApplicabilityDecision::Use
                })
                .count();

            let started = Instant::now();
            let gated: Vec<&Record> = rows
                .iter()
                .map(|(_, record)| record)
                .filter(|record| {
                    evaluate_applicability(record, &current_state).decision
                        == ApplicabilityDecision::Use
                })
                .collect();
            result.gate_time += started.elapsed();

            result.gated_candidates += gated.len();
            result.gated_inapplicable += gated
                .iter()
                .filter(|record| {
                    evaluate_applicability(record, &current_state).decision
                        != ApplicabilityDecision::Use
                })
                .count();
            if gated
                .first()
                .is_some_and(|record| expected(record, current_cause))
            {
                result.gated_correct += 1;
            }
        }
    }

    result.print();
    ensure!(result.baseline_correct * 2 == result.cases);
    ensure!(result.gated_correct == result.cases);
    ensure!(result.baseline_inapplicable * 2 == result.baseline_candidates);
    ensure!(result.gated_inapplicable == 0);

    let robustness = run_robustness_experiment(&aura, &pairs)?;
    print_robustness(&robustness);
    ensure!(robustness.correct_decisions == robustness.cases);
    ensure!(robustness.expected_use == robustness.actual_use);
    ensure!(robustness.expected_reject == robustness.actual_reject);
    ensure!(robustness.expected_unknown == robustness.actual_unknown);
    ensure!(robustness.gated_unsafe_auto_use == 0);
    Ok(())
}
