use anyhow::{Context, Result};
use aura::{Aura, Level, Record};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const TOP_K: usize = 5;
const CURRENT_BUSINESS_TIME: f64 = 1_000_000_000_000.0;

#[derive(Debug, Deserialize)]
struct Dataset {
    revision: String,
    description: String,
    records: Vec<RecordSpec>,
    queries: Vec<QuerySpec>,
}

#[derive(Debug, Clone, Deserialize)]
struct RecordSpec {
    key: String,
    namespace: String,
    content: String,
    #[serde(default)]
    valid_from: Option<f64>,
    #[serde(default)]
    valid_until: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct QuerySpec {
    id: String,
    slice: String,
    query: String,
    namespace: String,
    #[serde(default)]
    as_of: Option<f64>,
    expected_keys: Vec<String>,
    #[serde(default)]
    forbidden_keys: Vec<String>,
}

#[derive(Debug, Clone)]
struct IndexedRecord {
    key: String,
    namespace: String,
    content: String,
    valid_from: Option<f64>,
    valid_until: Option<f64>,
    sequence: usize,
}

#[derive(Debug, Serialize)]
struct EvalOutput {
    schema_version: u32,
    dataset_revision: String,
    dataset_description: String,
    generated_at_unix: u64,
    configuration: Configuration,
    corpus: CorpusStats,
    ingestion: LatencySummary,
    arms: BTreeMap<String, ArmResult>,
    tenant_interference: InterferenceResult,
    restart_consistency: RestartResult,
    acceptance: AcceptanceResult,
}

#[derive(Debug, Serialize)]
struct Configuration {
    top_k: usize,
    same_tenant_distractors: usize,
    neighbor_distractors_per_query: usize,
    cache_latency_iterations: usize,
    quality_uses_read_only_as_of_recall: bool,
}

#[derive(Debug, Serialize)]
struct CorpusStats {
    fixture_records: usize,
    same_tenant_distractors: usize,
    neighbor_distractors: usize,
    total_records: usize,
    query_count: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
struct QualityMetrics {
    answerable_queries: usize,
    recall_at_k: f64,
    mrr: f64,
    ndcg_at_k: f64,
    evidence_precision_at_k: f64,
    abstention_queries: usize,
    abstention_accuracy: f64,
    forbidden_exposure_rate: f64,
    namespace_contamination_rate: f64,
}

#[derive(Debug, Serialize)]
struct ArmResult {
    overall: QualityMetrics,
    by_slice: BTreeMap<String, QualityMetrics>,
    uncached_latency_ms: LatencySummary,
    cached_latency_ms: Option<LatencySummary>,
    per_query: Vec<QueryResult>,
}

#[derive(Debug, Clone, Serialize)]
struct QueryResult {
    id: String,
    slice: String,
    answerable: bool,
    expected_keys: Vec<String>,
    forbidden_keys: Vec<String>,
    retrieved: Vec<RetrievedItem>,
    recall_at_k: Option<f64>,
    reciprocal_rank: Option<f64>,
    ndcg_at_k: Option<f64>,
    evidence_precision_at_k: Option<f64>,
    abstained: bool,
    forbidden_exposed: bool,
    namespace_contaminated: bool,
    latency_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
struct RetrievedItem {
    key: String,
    score: f64,
    namespace: String,
}

#[derive(Debug, Clone, Serialize, Default)]
struct LatencySummary {
    samples: usize,
    mean: f64,
    median: f64,
    p95: f64,
}

#[derive(Debug, Serialize)]
struct InterferenceResult {
    before_neighbor_recall_at_k: f64,
    after_neighbor_recall_at_k: f64,
    recall_delta: f64,
    queries_with_expected_rank_loss: usize,
    max_expected_rank_loss: usize,
}

#[derive(Debug, Serialize)]
struct RestartResult {
    compared_queries: usize,
    identical_rankings: usize,
    identical_top_k_sets: usize,
    identical_expected_evidence: usize,
    consistency_rate: f64,
    set_consistency_rate: f64,
    evidence_consistency_rate: f64,
}

#[derive(Debug, Serialize)]
struct AcceptanceResult {
    passed: bool,
    checks: BTreeMap<String, bool>,
    informational: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct Options {
    quick: bool,
    strict: bool,
}

fn main() -> Result<()> {
    let options = parse_options()?;
    let same_tenant_distractors = if options.quick { 32 } else { 256 };
    let neighbor_distractors_per_query = if options.quick { 3 } else { 16 };
    let cache_latency_iterations = if options.quick { 25 } else { 200 };
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dataset: Dataset = serde_json::from_slice(&fs::read(manifest_dir.join("dataset.json"))?)?;
    validate_dataset(&dataset)?;

    let temporary = tempfile::tempdir()?;
    let store_path = temporary.path().join("brain");
    let aura = Aura::open(store_path.to_str().context("non-UTF-8 temporary path")?)?;
    aura.disable_full_cognitive_stack();

    let mut indexed = Vec::new();
    let mut id_to_key = HashMap::new();
    let mut ingestion_ms = Vec::new();
    for spec in &dataset.records {
        let started = Instant::now();
        let record = store_record(&aura, spec)?;
        ingestion_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        id_to_key.insert(record.id, spec.key.clone());
        indexed.push(indexed_record(spec, indexed.len()));
    }
    for index in 0..same_tenant_distractors {
        let namespace = if index % 5 == 0 {
            "project"
        } else {
            "background"
        };
        let spec = RecordSpec {
            key: format!("same_noise_{index:04}"),
            namespace: namespace.into(),
            content: format!("Routine telemetry observation {index:04} reports healthy queues, ordinary cache pressure, and no release incident."),
            valid_from: None,
            valid_until: None,
        };
        let started = Instant::now();
        let record = store_record(&aura, &spec)?;
        ingestion_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        id_to_key.insert(record.id, spec.key.clone());
        indexed.push(indexed_record(&spec, indexed.len()));
    }

    let before_neighbor = evaluate_aura(&aura, &dataset.queries, &id_to_key)?;

    let mut neighbor_count = 0;
    for (query_index, query) in dataset.queries.iter().enumerate() {
        for copy in 0..neighbor_distractors_per_query {
            let spec = RecordSpec {
                key: format!("neighbor_noise_{query_index:03}_{copy:03}"),
                namespace: "neighbor".into(),
                content: format!("Neighbor tenant decoy {copy:03}: {} This is unrelated external account telemetry.", query.query),
                valid_from: None,
                valid_until: None,
            };
            let started = Instant::now();
            let record = store_record(&aura, &spec)?;
            ingestion_ms.push(started.elapsed().as_secs_f64() * 1000.0);
            id_to_key.insert(record.id, spec.key.clone());
            indexed.push(indexed_record(&spec, indexed.len()));
            neighbor_count += 1;
        }
    }

    let aura_after = evaluate_aura(&aura, &dataset.queries, &id_to_key)?;
    let overlap_after = evaluate_baseline("token_overlap", &dataset.queries, |query| {
        token_overlap_rank(query, &indexed)
    });
    let recent_after = evaluate_baseline("recent_history", &dataset.queries, |query| {
        recent_rank(query, &indexed)
    });
    let cached_latency = measure_cached_latency(&aura, &dataset.queries, cache_latency_iterations)?;
    let interference = compare_interference(&before_neighbor, &aura_after);
    // Standard recall intentionally changes activation/coactivation state.
    // Compare the resulting state across close/reopen rather than comparing it
    // with the earlier read-only quality pass.
    let before_restart = evaluate_aura(&aura, &dataset.queries, &id_to_key)?;
    aura.close()?;
    drop(aura);

    let reopened = Aura::open(store_path.to_str().context("non-UTF-8 temporary path")?)?;
    reopened.disable_full_cognitive_stack();
    let after_restart = evaluate_aura(&reopened, &dataset.queries, &id_to_key)?;
    let restart = compare_restart(&before_restart, &after_restart);
    reopened.close()?;

    let mut arms = BTreeMap::new();
    arms.insert("aura".into(), summarize(aura_after));
    arms.insert("recent_history".into(), summarize(recent_after));
    arms.insert("token_overlap".into(), summarize(overlap_after));
    arms.get_mut("aura").unwrap().cached_latency_ms = Some(cached_latency);

    let aura_metrics = &arms["aura"].overall;
    let lexical_metrics = &arms["token_overlap"].overall;
    let mut checks = BTreeMap::new();
    checks.insert(
        "aura_recall_at_5_at_least_token_overlap".into(),
        aura_metrics.recall_at_k + 1e-9 >= lexical_metrics.recall_at_k,
    );
    checks.insert(
        "forbidden_exposure_is_zero".into(),
        aura_metrics.forbidden_exposure_rate == 0.0,
    );
    checks.insert(
        "namespace_contamination_is_zero".into(),
        aura_metrics.namespace_contamination_rate == 0.0,
    );
    checks.insert(
        "neighbor_recall_drop_at_most_5pp".into(),
        interference.recall_delta >= -0.05,
    );
    checks.insert(
        "restart_top_k_sets_are_identical".into(),
        restart.identical_top_k_sets == restart.compared_queries,
    );
    checks.insert(
        "restart_expected_evidence_is_identical".into(),
        restart.identical_expected_evidence == restart.compared_queries,
    );
    let passed = checks.values().all(|value| *value);
    let acceptance = AcceptanceResult {
        passed,
        checks,
        informational: vec![
            "Abstention accuracy is reported but not gated until a confidence policy is specified.".into(),
            "This v1 corpus is synthetic and must not be presented as a competitor benchmark.".into(),
            "Aura quality uses read-only recall_as_of to prevent query-order activation from changing ranking.".into(),
        ],
    };

    let output = EvalOutput {
        schema_version: 1,
        dataset_revision: dataset.revision,
        dataset_description: dataset.description,
        generated_at_unix: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
        configuration: Configuration {
            top_k: TOP_K,
            same_tenant_distractors,
            neighbor_distractors_per_query,
            cache_latency_iterations,
            quality_uses_read_only_as_of_recall: true,
        },
        corpus: CorpusStats {
            fixture_records: dataset.records.len(),
            same_tenant_distractors,
            neighbor_distractors: neighbor_count,
            total_records: indexed.len(),
            query_count: dataset.queries.len(),
        },
        ingestion: latency_summary(&ingestion_ms),
        arms,
        tenant_interference: interference,
        restart_consistency: restart,
        acceptance,
    };
    let output_path = manifest_dir.join("results.json");
    fs::write(&output_path, serde_json::to_vec_pretty(&output)?)?;
    print_summary(&output, &output_path);
    if options.strict && !output.acceptance.passed {
        anyhow::bail!(
            "memory-quality acceptance gate failed; inspect {}",
            output_path.display()
        );
    }
    Ok(())
}

fn parse_options() -> Result<Options> {
    let mut options = Options {
        quick: false,
        strict: false,
    };
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--quick" => options.quick = true,
            "--strict" => options.strict = true,
            "--help" | "-h" => {
                println!("Usage: cargo run --release --manifest-path experiments/memory_quality_eval/Cargo.toml -- [--quick] [--strict]");
                std::process::exit(0);
            }
            _ => anyhow::bail!("unknown argument: {arg}"),
        }
    }
    Ok(options)
}

fn validate_dataset(dataset: &Dataset) -> Result<()> {
    anyhow::ensure!(!dataset.records.is_empty(), "dataset has no records");
    anyhow::ensure!(!dataset.queries.is_empty(), "dataset has no queries");
    let keys: HashSet<&str> = dataset
        .records
        .iter()
        .map(|record| record.key.as_str())
        .collect();
    anyhow::ensure!(keys.len() == dataset.records.len(), "duplicate record key");
    let mut query_ids = HashSet::new();
    for query in &dataset.queries {
        anyhow::ensure!(query_ids.insert(query.id.as_str()), "duplicate query id");
        for key in query.expected_keys.iter().chain(&query.forbidden_keys) {
            anyhow::ensure!(
                keys.contains(key.as_str()),
                "query {} references unknown key {}",
                query.id,
                key
            );
        }
        anyhow::ensure!(
            query
                .expected_keys
                .iter()
                .all(|key| !query.forbidden_keys.contains(key)),
            "query {} marks evidence expected and forbidden",
            query.id
        );
    }
    Ok(())
}

fn store_record(aura: &Aura, spec: &RecordSpec) -> Result<Record> {
    if spec.valid_from.is_some() || spec.valid_until.is_some() {
        aura.store_temporal(
            &spec.content,
            spec.valid_from,
            spec.valid_until,
            Some(Level::Domain),
            Some(vec!["memory-quality-eval".into()]),
            Some(&spec.namespace),
        )
    } else {
        aura.store(
            &spec.content,
            Some(Level::Domain),
            Some(vec!["memory-quality-eval".into()]),
            None,
            Some("text/plain"),
            Some("recorded"),
            None,
            Some(false),
            None,
            Some(&spec.namespace),
            Some("fact"),
        )
    }
}

fn indexed_record(spec: &RecordSpec, sequence: usize) -> IndexedRecord {
    IndexedRecord {
        key: spec.key.clone(),
        namespace: spec.namespace.clone(),
        content: spec.content.clone(),
        valid_from: spec.valid_from,
        valid_until: spec.valid_until,
        sequence,
    }
}

fn evaluate_aura(
    aura: &Aura,
    queries: &[QuerySpec],
    id_to_key: &HashMap<String, String>,
) -> Result<Vec<QueryResult>> {
    queries
        .iter()
        .map(|query| {
            let started = Instant::now();
            let rows = aura.recall_as_of(
                &query.query,
                query.as_of.unwrap_or(CURRENT_BUSINESS_TIME),
                Some(TOP_K),
                Some(0.0),
                Some(false),
                Some(&[query.namespace.as_str()]),
            )?;
            let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
            let retrieved = rows
                .into_iter()
                .map(|(score, record)| RetrievedItem {
                    key: id_to_key
                        .get(&record.id)
                        .cloned()
                        .unwrap_or_else(|| record.id.clone()),
                    score: score as f64,
                    namespace: record.namespace,
                })
                .collect();
            Ok(score_query(query, retrieved, latency_ms))
        })
        .collect()
}

fn evaluate_baseline<F>(_name: &str, queries: &[QuerySpec], mut rank: F) -> Vec<QueryResult>
where
    F: FnMut(&QuerySpec) -> Vec<RetrievedItem>,
{
    queries
        .iter()
        .map(|query| {
            let started = Instant::now();
            let retrieved = rank(query);
            let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
            score_query(query, retrieved, latency_ms)
        })
        .collect()
}

fn token_overlap_rank(query: &QuerySpec, records: &[IndexedRecord]) -> Vec<RetrievedItem> {
    let query_terms = terms(&query.query);
    let eligible_records: Vec<&IndexedRecord> = records
        .iter()
        .filter(|record| eligible(record, query))
        .collect();
    let document_count = eligible_records.len() as f64;
    let avg_len = eligible_records
        .iter()
        .map(|record| terms(&record.content).len())
        .sum::<usize>() as f64
        / document_count.max(1.0);
    let mut scored = eligible_records
        .into_iter()
        .filter_map(|record| {
            let doc_terms = terms(&record.content);
            let mut frequencies = HashMap::new();
            for term in &doc_terms {
                *frequencies.entry(term.as_str()).or_insert(0usize) += 1;
            }
            let mut score = 0.0;
            for term in &query_terms {
                let df = records
                    .iter()
                    .filter(|candidate| {
                        eligible(candidate, query) && terms(&candidate.content).contains(term)
                    })
                    .count() as f64;
                let idf = ((document_count - df + 0.5) / (df + 0.5) + 1.0).ln();
                let tf = *frequencies.get(term.as_str()).unwrap_or(&0) as f64;
                if tf > 0.0 {
                    let normalization =
                        tf + 1.2 * (1.0 - 0.75 + 0.75 * doc_terms.len() as f64 / avg_len.max(1.0));
                    score += idf * tf * 2.2 / normalization;
                }
            }
            (score > 0.0).then_some(RetrievedItem {
                key: record.key.clone(),
                score,
                namespace: record.namespace.clone(),
            })
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.key.cmp(&right.key))
    });
    scored.truncate(TOP_K);
    scored
}

fn recent_rank(query: &QuerySpec, records: &[IndexedRecord]) -> Vec<RetrievedItem> {
    let mut eligible = records
        .iter()
        .filter(|record| eligible(record, query))
        .collect::<Vec<_>>();
    eligible.sort_by_key(|record| std::cmp::Reverse(record.sequence));
    eligible
        .into_iter()
        .take(TOP_K)
        .map(|record| RetrievedItem {
            key: record.key.clone(),
            score: record.sequence as f64,
            namespace: record.namespace.clone(),
        })
        .collect()
}

fn eligible(record: &IndexedRecord, query: &QuerySpec) -> bool {
    if record.namespace != query.namespace {
        return false;
    }
    let at = query.as_of.unwrap_or(CURRENT_BUSINESS_TIME);
    record.valid_from.is_none_or(|from| from <= at)
        && record.valid_until.is_none_or(|until| at < until)
}

fn terms(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .filter(|term| term.chars().count() > 1)
        .map(str::to_string)
        .collect()
}

fn score_query(query: &QuerySpec, retrieved: Vec<RetrievedItem>, latency_ms: f64) -> QueryResult {
    let expected: HashSet<&str> = query.expected_keys.iter().map(String::as_str).collect();
    let relevant = retrieved
        .iter()
        .filter(|item| expected.contains(item.key.as_str()))
        .count();
    let answerable = !expected.is_empty();
    let recall = answerable.then_some(relevant as f64 / expected.len() as f64);
    let reciprocal_rank = answerable.then_some(
        retrieved
            .iter()
            .position(|item| expected.contains(item.key.as_str()))
            .map(|rank| 1.0 / (rank + 1) as f64)
            .unwrap_or(0.0),
    );
    let dcg = retrieved
        .iter()
        .enumerate()
        .filter(|(_, item)| expected.contains(item.key.as_str()))
        .map(|(rank, _)| 1.0 / ((rank + 2) as f64).log2())
        .sum::<f64>();
    let ideal = (0..expected.len().min(TOP_K))
        .map(|rank| 1.0 / ((rank + 2) as f64).log2())
        .sum::<f64>();
    let evidence_precision = answerable.then_some(relevant as f64 / retrieved.len().max(1) as f64);
    let abstained = !answerable && retrieved.is_empty();
    let forbidden_exposed = retrieved
        .iter()
        .any(|item| query.forbidden_keys.contains(&item.key));
    let namespace_contaminated = retrieved
        .iter()
        .any(|item| item.namespace != query.namespace);
    QueryResult {
        id: query.id.clone(),
        slice: query.slice.clone(),
        answerable,
        expected_keys: query.expected_keys.clone(),
        forbidden_keys: query.forbidden_keys.clone(),
        retrieved,
        recall_at_k: recall,
        reciprocal_rank,
        ndcg_at_k: answerable.then_some(if ideal > 0.0 { dcg / ideal } else { 0.0 }),
        evidence_precision_at_k: evidence_precision,
        abstained,
        forbidden_exposed,
        namespace_contaminated,
        latency_ms,
    }
}

fn summarize(per_query: Vec<QueryResult>) -> ArmResult {
    let overall = aggregate(&per_query);
    let mut slices: BTreeMap<String, Vec<QueryResult>> = BTreeMap::new();
    for result in &per_query {
        slices
            .entry(result.slice.clone())
            .or_default()
            .push(result.clone());
    }
    ArmResult {
        overall,
        by_slice: slices
            .into_iter()
            .map(|(name, rows)| (name, aggregate(&rows)))
            .collect(),
        uncached_latency_ms: latency_summary(
            &per_query
                .iter()
                .map(|row| row.latency_ms)
                .collect::<Vec<_>>(),
        ),
        cached_latency_ms: None,
        per_query,
    }
}

fn aggregate(rows: &[QueryResult]) -> QualityMetrics {
    let answerable: Vec<&QueryResult> = rows.iter().filter(|row| row.answerable).collect();
    let abstention: Vec<&QueryResult> = rows.iter().filter(|row| !row.answerable).collect();
    let mean = |values: Vec<f64>| values.iter().sum::<f64>() / values.len().max(1) as f64;
    QualityMetrics {
        answerable_queries: answerable.len(),
        recall_at_k: mean(
            answerable
                .iter()
                .filter_map(|row| row.recall_at_k)
                .collect(),
        ),
        mrr: mean(
            answerable
                .iter()
                .filter_map(|row| row.reciprocal_rank)
                .collect(),
        ),
        ndcg_at_k: mean(answerable.iter().filter_map(|row| row.ndcg_at_k).collect()),
        evidence_precision_at_k: mean(
            answerable
                .iter()
                .filter_map(|row| row.evidence_precision_at_k)
                .collect(),
        ),
        abstention_queries: abstention.len(),
        abstention_accuracy: mean(
            abstention
                .iter()
                .map(|row| row.abstained as u8 as f64)
                .collect(),
        ),
        forbidden_exposure_rate: mean(
            rows.iter()
                .map(|row| row.forbidden_exposed as u8 as f64)
                .collect(),
        ),
        namespace_contamination_rate: mean(
            rows.iter()
                .map(|row| row.namespace_contaminated as u8 as f64)
                .collect(),
        ),
    }
}

fn measure_cached_latency(
    aura: &Aura,
    queries: &[QuerySpec],
    iterations: usize,
) -> Result<LatencySummary> {
    let static_queries: Vec<&QuerySpec> = queries
        .iter()
        .filter(|query| query.as_of.is_none())
        .collect();
    for query in &static_queries {
        let _ = aura.recall_structured(
            &query.query,
            Some(TOP_K),
            Some(0.0),
            Some(false),
            None,
            Some(&[query.namespace.as_str()]),
        )?;
    }
    let mut samples = Vec::new();
    for iteration in 0..iterations {
        let query = static_queries[iteration % static_queries.len()];
        let started = Instant::now();
        let _ = aura.recall_structured(
            &query.query,
            Some(TOP_K),
            Some(0.0),
            Some(false),
            None,
            Some(&[query.namespace.as_str()]),
        )?;
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    Ok(latency_summary(&samples))
}

fn latency_summary(samples: &[f64]) -> LatencySummary {
    if samples.is_empty() {
        return LatencySummary::default();
    }
    let mut ordered = samples.to_vec();
    ordered.sort_by(f64::total_cmp);
    let percentile =
        |fraction: f64| ordered[((ordered.len() - 1) as f64 * fraction).ceil() as usize];
    LatencySummary {
        samples: ordered.len(),
        mean: ordered.iter().sum::<f64>() / ordered.len() as f64,
        median: percentile(0.5),
        p95: percentile(0.95),
    }
}

fn compare_interference(before: &[QueryResult], after: &[QueryResult]) -> InterferenceResult {
    let before_metrics = aggregate(before);
    let after_metrics = aggregate(after);
    let before_map: HashMap<&str, &QueryResult> =
        before.iter().map(|row| (row.id.as_str(), row)).collect();
    let mut losses = Vec::new();
    for row in after {
        let before_row = before_map[&row.id.as_str()];
        let first_rank = |result: &QueryResult| {
            result
                .retrieved
                .iter()
                .position(|item| result.expected_keys.contains(&item.key))
                .unwrap_or(TOP_K + 1)
        };
        let old = first_rank(before_row);
        let new = first_rank(row);
        if new > old {
            losses.push(new - old);
        }
    }
    InterferenceResult {
        before_neighbor_recall_at_k: before_metrics.recall_at_k,
        after_neighbor_recall_at_k: after_metrics.recall_at_k,
        recall_delta: after_metrics.recall_at_k - before_metrics.recall_at_k,
        queries_with_expected_rank_loss: losses.len(),
        max_expected_rank_loss: losses.into_iter().max().unwrap_or(0),
    }
}

fn compare_restart(before: &[QueryResult], after: &[QueryResult]) -> RestartResult {
    let after: HashMap<&str, &QueryResult> =
        after.iter().map(|row| (row.id.as_str(), row)).collect();
    let mut identical_rankings = 0;
    let mut identical_top_k_sets = 0;
    let mut identical_expected_evidence = 0;
    for old in before {
        let Some(new) = after.get(old.id.as_str()) else {
            continue;
        };
        let old_ranking: Vec<&str> = old.retrieved.iter().map(|item| item.key.as_str()).collect();
        let new_ranking: Vec<&str> = new.retrieved.iter().map(|item| item.key.as_str()).collect();
        if old_ranking == new_ranking {
            identical_rankings += 1;
        }
        if old_ranking.iter().copied().collect::<HashSet<_>>()
            == new_ranking.iter().copied().collect::<HashSet<_>>()
        {
            identical_top_k_sets += 1;
        }
        let expected: HashSet<&str> = old.expected_keys.iter().map(String::as_str).collect();
        let old_evidence: HashSet<&str> = old_ranking
            .iter()
            .copied()
            .filter(|key| expected.contains(key))
            .collect();
        let new_evidence: HashSet<&str> = new_ranking
            .iter()
            .copied()
            .filter(|key| expected.contains(key))
            .collect();
        if old_evidence == new_evidence {
            identical_expected_evidence += 1;
        }
    }
    let count = before.len();
    RestartResult {
        compared_queries: count,
        identical_rankings,
        identical_top_k_sets,
        identical_expected_evidence,
        consistency_rate: identical_rankings as f64 / count.max(1) as f64,
        set_consistency_rate: identical_top_k_sets as f64 / count.max(1) as f64,
        evidence_consistency_rate: identical_expected_evidence as f64 / count.max(1) as f64,
    }
}

fn print_summary(output: &EvalOutput, output_path: &Path) {
    println!(
        "dataset={} records={} queries={}",
        output.dataset_revision, output.corpus.total_records, output.corpus.query_count
    );
    for (name, arm) in &output.arms {
        println!(
            "{name}: recall@{}={:.3} mrr={:.3} ndcg={:.3} precision={:.3} abstention={:.3}",
            TOP_K,
            arm.overall.recall_at_k,
            arm.overall.mrr,
            arm.overall.ndcg_at_k,
            arm.overall.evidence_precision_at_k,
            arm.overall.abstention_accuracy
        );
    }
    println!(
        "tenant_interference_delta={:.3} restart_consistency={:.3}",
        output.tenant_interference.recall_delta, output.restart_consistency.consistency_rate
    );
    println!(
        "acceptance_gate={} results={}",
        output.acceptance.passed,
        output_path.display()
    );
}
