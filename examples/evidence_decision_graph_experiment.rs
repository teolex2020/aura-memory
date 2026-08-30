//! Reproducible production-API benchmark for Aura's Evidence & Decision Graph.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::hint::black_box;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{ensure, Context, Result};
use aura::{
    AuditEntityKind, AuditEntityStatus, AuditRelationKind, Aura, DecisionAuditExplanation, Level,
};

const NAMESPACE: &str = "evidence-decision-experiment";
const SCENARIOS: usize = 50;
const QUERY_REPETITIONS: usize = 100;
const MIN_COVERAGE_GAIN_PERCENTAGE_POINTS: f64 = 50.0;
const MAX_QUERY_P95_MICROS: f64 = 1_000.0;
const MAX_STORAGE_OVERHEAD_PERCENT: f64 = 15.0;

#[derive(Clone, Copy)]
struct EntitySpec {
    suffix: &'static str,
    kind: AuditEntityKind,
    status: AuditEntityStatus,
}

struct Fixture {
    decision_entity_id: String,
    decision_record_id: String,
    expected_related_ids: BTreeSet<String>,
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn specs() -> [EntitySpec; 10] {
    [
        EntitySpec {
            suffix: "source-a",
            kind: AuditEntityKind::Source,
            status: AuditEntityStatus::Observed,
        },
        EntitySpec {
            suffix: "source-b",
            kind: AuditEntityKind::Source,
            status: AuditEntityStatus::Observed,
        },
        EntitySpec {
            suffix: "source-c",
            kind: AuditEntityKind::Source,
            status: AuditEntityStatus::Observed,
        },
        EntitySpec {
            suffix: "claim-a",
            kind: AuditEntityKind::Claim,
            status: AuditEntityStatus::Accepted,
        },
        EntitySpec {
            suffix: "claim-b",
            kind: AuditEntityKind::Claim,
            status: AuditEntityStatus::Accepted,
        },
        EntitySpec {
            suffix: "claim-c",
            kind: AuditEntityKind::Claim,
            status: AuditEntityStatus::Rejected,
        },
        EntitySpec {
            suffix: "decision",
            kind: AuditEntityKind::Decision,
            status: AuditEntityStatus::Decided,
        },
        EntitySpec {
            suffix: "action",
            kind: AuditEntityKind::Action,
            status: AuditEntityStatus::Completed,
        },
        EntitySpec {
            suffix: "artifact",
            kind: AuditEntityKind::Artifact,
            status: AuditEntityStatus::Produced,
        },
        EntitySpec {
            suffix: "verification",
            kind: AuditEntityKind::Verification,
            status: AuditEntityStatus::Verified,
        },
    ]
}

fn parent_suffix(suffix: &str) -> Option<&'static str> {
    match suffix {
        "claim-a" => Some("source-a"),
        "claim-b" => Some("source-b"),
        "claim-c" => Some("source-c"),
        "decision" => Some("claim-a"),
        "action" => Some("decision"),
        "artifact" => Some("action"),
        "verification" => Some("artifact"),
        _ => None,
    }
}

fn relation_specs() -> [(&'static str, &'static str, AuditRelationKind); 10] {
    [
        ("source-a", "claim-a", AuditRelationKind::Supports),
        ("source-b", "claim-b", AuditRelationKind::Supports),
        ("source-c", "claim-c", AuditRelationKind::Supports),
        ("claim-c", "claim-a", AuditRelationKind::Contradicts),
        ("claim-a", "decision", AuditRelationKind::RecalledFor),
        ("claim-b", "decision", AuditRelationKind::RecalledFor),
        ("claim-c", "decision", AuditRelationKind::RecalledFor),
        ("decision", "action", AuditRelationKind::Caused),
        ("action", "artifact", AuditRelationKind::Produced),
        ("artifact", "verification", AuditRelationKind::VerifiedBy),
    ]
}

fn store_dataset(aura: &Aura, audit_graph: bool) -> Result<Vec<Fixture>> {
    let mut fixtures = Vec::new();
    for index in 0..SCENARIOS {
        let scenario = format!("case-{index:03}");
        let mut record_ids = HashMap::new();
        let mut expected_related_ids = BTreeSet::new();
        let decision_entity_id = format!("{scenario}/decision");
        let mut decision_record_id = None;

        for spec in specs() {
            let entity_id = format!("{scenario}/{}", spec.suffix);
            if entity_id != decision_entity_id {
                expected_related_ids.insert(entity_id.clone());
            }
            let parent_record_id = parent_suffix(spec.suffix)
                .and_then(|suffix| record_ids.get(suffix))
                .cloned();
            let semantic_type = if spec.kind == AuditEntityKind::Decision {
                "decision"
            } else if spec.status == AuditEntityStatus::Rejected {
                "contradiction"
            } else {
                "fact"
            };
            let record = aura.store_with_channel(
                &format!("{scenario}: audit entity {}", spec.suffix),
                Some(
                    if matches!(
                        spec.kind,
                        AuditEntityKind::Decision | AuditEntityKind::Action
                    ) {
                        Level::Decisions
                    } else {
                        Level::Domain
                    },
                ),
                Some(vec!["evidence-decision-graph-experiment".into()]),
                Some(false),
                Some("json"),
                Some(if spec.kind == AuditEntityKind::Source {
                    "retrieved"
                } else {
                    "recorded"
                }),
                None,
                Some(false),
                parent_record_id.as_deref(),
                Some("experiment"),
                Some(false),
                Some(NAMESPACE),
                Some(semantic_type),
            )?;
            if audit_graph {
                aura.annotate_audit_entity(&record.id, spec.kind, spec.status, Some(&entity_id))?;
            }
            if spec.suffix == "decision" {
                decision_record_id = Some(record.id.clone());
            }
            record_ids.insert(spec.suffix, record.id);
        }

        if audit_graph {
            for (from, to, relation) in relation_specs() {
                aura.link_audit_entities(
                    &format!("{scenario}/{from}"),
                    &format!("{scenario}/{to}"),
                    relation,
                    None,
                    None,
                )?;
            }
        }
        fixtures.push(Fixture {
            decision_entity_id,
            decision_record_id: decision_record_id.context("decision record was not stored")?,
            expected_related_ids,
        });
    }
    Ok(fixtures)
}

fn related_ids(explanation: &DecisionAuditExplanation) -> BTreeSet<String> {
    explanation
        .evidence
        .iter()
        .map(|trace| trace.claim.entity_id.clone())
        .chain(
            explanation
                .evidence
                .iter()
                .flat_map(|trace| trace.source_edges.iter())
                .map(|edge| edge.from_entity_id.clone()),
        )
        .chain(
            explanation
                .actions
                .iter()
                .map(|node| node.entity_id.clone()),
        )
        .chain(
            explanation
                .artifacts
                .iter()
                .map(|node| node.entity_id.clone()),
        )
        .chain(
            explanation
                .verifications
                .iter()
                .map(|node| node.entity_id.clone()),
        )
        .collect()
}

fn percent(part: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        part as f64 * 100.0 / total as f64
    }
}

fn percentile_micros(samples: &mut [Duration], percentile: f64) -> f64 {
    samples.sort_unstable();
    let index = ((samples.len() - 1) as f64 * percentile)
        .round()
        .clamp(0.0, (samples.len() - 1) as f64) as usize;
    samples[index].as_secs_f64() * 1_000_000.0
}

fn directory_size(path: &Path) -> Result<u64> {
    let mut total = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            total += directory_size(&entry.path())?;
        } else {
            total += metadata.len();
        }
    }
    Ok(total)
}

fn main() -> Result<()> {
    let baseline_dir = tempfile::tempdir()?;
    let graph_dir = tempfile::tempdir()?;
    let baseline_path = baseline_dir
        .path()
        .to_str()
        .context("baseline path must be valid UTF-8")?;
    let graph_path = graph_dir
        .path()
        .to_str()
        .context("graph path must be valid UTF-8")?;

    let baseline = Aura::open(baseline_path)?;
    let baseline_fixtures = store_dataset(&baseline, false)?;
    baseline.flush()?;
    let baseline_bytes = directory_size(baseline_dir.path())?;

    let experimental = Aura::open(graph_path)?;
    let fixtures = store_dataset(&experimental, true)?;
    experimental.flush()?;
    let graph_bytes = directory_size(graph_dir.path())?;

    let build_started = Instant::now();
    let graph = experimental.audit_graph(Some(NAMESPACE))?;
    let build_time = build_started.elapsed();
    let total_related_nodes = SCENARIOS * 9;
    let baseline_nodes_found = baseline_fixtures
        .iter()
        .filter_map(|fixture| baseline.provenance_chain(&fixture.decision_record_id))
        .filter(|chain| chain.because_record_id.is_some())
        .count();
    let mut graph_nodes_found = 0;
    for fixture in &fixtures {
        let explanation = graph.explain_decision(&fixture.decision_entity_id)?;
        graph_nodes_found += related_ids(&explanation)
            .intersection(&fixture.expected_related_ids)
            .count();
        ensure!(explanation.evidence.len() == 3);
        ensure!(explanation.conflicts.len() == 1);
        ensure!(explanation.missing_links.is_empty());
    }
    ensure!(graph.edges.len() == SCENARIOS * 10);

    let baseline_coverage = percent(baseline_nodes_found, total_related_nodes);
    let graph_coverage = percent(graph_nodes_found, total_related_nodes);
    let coverage_gain = graph_coverage - baseline_coverage;

    let mut baseline_samples = Vec::with_capacity(SCENARIOS * QUERY_REPETITIONS);
    let mut graph_samples = Vec::with_capacity(SCENARIOS * QUERY_REPETITIONS);
    for _ in 0..QUERY_REPETITIONS {
        for fixture in &baseline_fixtures {
            let started = Instant::now();
            black_box(baseline.provenance_chain(&fixture.decision_record_id));
            baseline_samples.push(started.elapsed());
        }
        for fixture in &fixtures {
            let started = Instant::now();
            black_box(graph.explain_decision(&fixture.decision_entity_id)?);
            graph_samples.push(started.elapsed());
        }
    }
    let baseline_p95 = percentile_micros(&mut baseline_samples, 0.95);
    let graph_p95 = percentile_micros(&mut graph_samples, 0.95);

    let evaluated_at = now() + 1.0;
    let before_graph = experimental.audit_graph_at(evaluated_at, Some(NAMESPACE))?;
    let before_restart = before_graph.to_compact_json()?;
    experimental.close()?;
    drop(experimental);
    let reopened = Aura::open(graph_path)?;
    let after_graph = reopened.audit_graph_at(evaluated_at, Some(NAMESPACE))?;
    let after_restart = after_graph.to_compact_json()?;
    let restart_deterministic = before_restart == after_restart;
    if !restart_deterministic {
        println!(
            "Restart diagnostic:       nodes {} -> {}, edges {} -> {}",
            before_graph.nodes.len(),
            after_graph.nodes.len(),
            before_graph.edges.len(),
            after_graph.edges.len()
        );
        if let Some((before, after)) = before_graph
            .nodes
            .iter()
            .zip(&after_graph.nodes)
            .find(|(before, after)| before != after)
        {
            println!("First node mismatch:       {before:?} -> {after:?}");
        }
        if let Some((before, after)) = before_graph
            .edges
            .iter()
            .zip(&after_graph.edges)
            .find(|(before, after)| before != after)
        {
            println!("First edge mismatch:       {before:?} -> {after:?}");
        }
    }

    let storage_overhead =
        (graph_bytes.saturating_sub(baseline_bytes)) as f64 * 100.0 / baseline_bytes as f64;
    let build_micros_per_decision = build_time.as_secs_f64() * 1_000_000.0 / SCENARIOS as f64;
    let passes = coverage_gain >= MIN_COVERAGE_GAIN_PERCENTAGE_POINTS
        && graph_coverage == 100.0
        && graph_p95 <= MAX_QUERY_P95_MICROS
        && storage_overhead <= MAX_STORAGE_OVERHEAD_PERCENT
        && restart_deterministic;

    println!("Aura Evidence & Decision Graph production experiment");
    println!("====================================================");
    println!(
        "Scenarios / graph records: {SCENARIOS} / {}",
        SCENARIOS * 10
    );
    println!(
        "Related-node coverage:    {baseline_coverage:.1}% -> {graph_coverage:.1}% ({coverage_gain:+.1} pp)"
    );
    println!("Typed-edge coverage:       100.0%");
    println!("Restart deterministic:     {restart_deterministic}");
    println!("Graph rebuild:             {build_micros_per_decision:.2} us/decision");
    println!("Baseline explanation p95:  {baseline_p95:.2} us");
    println!("Graph explanation p95:     {graph_p95:.2} us");
    println!(
        "Storage:                   {baseline_bytes} -> {graph_bytes} bytes ({storage_overhead:+.2}%)"
    );
    println!(
        "Verdict:                   {}",
        if passes { "PASS" } else { "FAIL" }
    );

    reopened.close()?;
    baseline.close()?;
    ensure!(
        passes,
        "production integration missed the experiment threshold"
    );
    Ok(())
}
