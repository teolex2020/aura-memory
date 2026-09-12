use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::hint::black_box;
use std::path::Path;
use std::time::Instant;

use aura::context_capsule::build_context_capsule_at;
use aura::{ContextCapsule, ContextCapsuleEntry, ContextCategory, Level, Record};

const ENTRY_OVERHEAD_TOKENS: usize = 16;
const TARGET_BUDGET: usize = 640;
const ITERATIONS: usize = 20_000;

#[derive(Debug, Clone)]
struct CompactedEntry {
    record_id: String,
    category: ContextCategory,
    content: String,
    source_type: String,
    semantic_type: String,
    level: Level,
    confidence: f32,
    strength: f32,
    salience: f32,
    estimated_tokens: usize,
    selection_reasons: Vec<String>,
}

#[derive(Debug)]
struct Fixture {
    records: Vec<Record>,
    required_spans: BTreeMap<String, Vec<&'static str>>,
}

#[derive(Debug)]
struct PromptEntry<'a> {
    record_id: &'a str,
    content: &'a str,
}

#[derive(Debug)]
struct QaProbe {
    question: &'static str,
    expected: &'static str,
}

#[derive(Debug)]
struct QaScore {
    answerable: usize,
    extractive_correct: usize,
    total: usize,
    correct: Vec<bool>,
}

fn main() {
    let fixture = fixture();
    let capsule = build_context_capsule_at(
        &fixture.records,
        "experiment",
        "prepare secure production deployment release cache memory",
        32_768,
        1_800_000_000.0,
    );
    let compacted = compact_capsule(&capsule);
    let original_store: BTreeMap<&str, &str> = capsule
        .entries
        .iter()
        .map(|entry| (entry.record_id.as_str(), entry.content.as_str()))
        .collect();

    let baseline_tokens: usize = capsule
        .entries
        .iter()
        .map(|entry| entry.estimated_tokens)
        .sum();
    let compacted_tokens: usize = compacted.iter().map(|entry| entry.estimated_tokens).sum();
    let reduction = 1.0 - compacted_tokens as f64 / baseline_tokens as f64;

    let (retained, required) = critical_span_retention(&compacted, &fixture.required_spans);
    let critical_retention = retained as f64 / required as f64;
    let metadata_unchanged = compacted
        .iter()
        .zip(&capsule.entries)
        .all(|(compacted, original)| metadata_is_unchanged(compacted, original));
    let reversible = compacted
        .iter()
        .zip(&capsule.entries)
        .all(|(entry, original)| {
            expand_content(entry, &original_store) == Some(original.content.as_str())
        });
    let order_unchanged = compacted
        .iter()
        .map(|entry| &entry.record_id)
        .eq(capsule.entries.iter().map(|entry| &entry.record_id));

    let baseline_fit = entries_that_fit(
        capsule.entries.iter().map(|entry| entry.estimated_tokens),
        TARGET_BUDGET,
    );
    let compacted_fit = entries_that_fit(
        compacted.iter().map(|entry| entry.estimated_tokens),
        TARGET_BUDGET,
    );
    let latency = latency_distribution(&capsule);
    let baseline_prompt: Vec<PromptEntry<'_>> = capsule
        .entries
        .iter()
        .take(baseline_fit)
        .map(|entry| PromptEntry {
            record_id: &entry.record_id,
            content: &entry.content,
        })
        .collect();
    let compacted_prompt: Vec<PromptEntry<'_>> = compacted
        .iter()
        .take(compacted_fit)
        .map(|entry| PromptEntry {
            record_id: &entry.record_id,
            content: &entry.content,
        })
        .collect();
    let compacted_same_coverage_prompt: Vec<PromptEntry<'_>> = compacted
        .iter()
        .take(baseline_fit)
        .map(|entry| PromptEntry {
            record_id: &entry.record_id,
            content: &entry.content,
        })
        .collect();
    let qa_probes = qa_probes();
    let baseline_qa = evaluate_qa(&baseline_prompt, &qa_probes);
    let compacted_same_coverage_qa = evaluate_qa(&compacted_same_coverage_prompt, &qa_probes);
    let compacted_qa = evaluate_qa(&compacted_prompt, &qa_probes);
    let baseline_accuracy = baseline_qa.extractive_correct as f64 / baseline_qa.total as f64;
    let compacted_accuracy = compacted_qa.extractive_correct as f64 / compacted_qa.total as f64;
    let qa_gain_points = (compacted_accuracy - baseline_accuracy) * 100.0;
    let qa_regressions = baseline_qa
        .correct
        .iter()
        .zip(&compacted_qa.correct)
        .filter(|(baseline, compacted)| **baseline && !**compacted)
        .count();
    let same_coverage_regressions = baseline_qa
        .correct
        .iter()
        .zip(&compacted_same_coverage_qa.correct)
        .filter(|(baseline, compacted)| **baseline && !**compacted)
        .count();

    if std::env::args().any(|argument| argument == "--emit-model-ab") {
        emit_model_ab(&baseline_prompt, &compacted_prompt, &qa_probes)
            .expect("failed to emit model A/B fixtures");
    }

    let reduction_gate = reduction >= 0.30;
    let retention_gate = retained == required;
    let metadata_gate = metadata_unchanged && order_unchanged;
    let reversibility_gate = reversible;
    let latency_gate = latency.p95_ns < 1_000_000;
    let structural_passed =
        reduction_gate && retention_gate && metadata_gate && reversibility_gate && latency_gate;
    let qa_gate = compacted_qa.extractive_correct > baseline_qa.extractive_correct
        && qa_regressions == 0
        && same_coverage_regressions == 0;
    let passed = structural_passed && qa_gate;

    println!("Aura loss-aware context compaction experiment");
    println!("dataset_entries={}", capsule.entries.len());
    println!("baseline_estimated_tokens={baseline_tokens}");
    println!("compacted_estimated_tokens={compacted_tokens}");
    println!("token_reduction_percent={:.2}", reduction * 100.0);
    println!("critical_spans_retained={retained}/{required}");
    println!(
        "critical_span_retention_percent={:.2}",
        critical_retention * 100.0
    );
    println!("structured_metadata_unchanged={metadata_unchanged}");
    println!("entry_order_unchanged={order_unchanged}");
    println!("exact_expansion_available={reversible}");
    println!("entries_fitting_{TARGET_BUDGET}_token_budget_baseline={baseline_fit}");
    println!("entries_fitting_{TARGET_BUDGET}_token_budget_compacted={compacted_fit}");
    println!("latency_iterations={ITERATIONS}");
    println!("latency_median_ns={}", latency.median_ns);
    println!("latency_p95_ns={}", latency.p95_ns);
    println!(
        "qa_answerable_baseline={}/{}",
        baseline_qa.answerable, baseline_qa.total
    );
    println!(
        "qa_answerable_compacted={}/{}",
        compacted_qa.answerable, compacted_qa.total
    );
    println!(
        "qa_extractive_correct_baseline={}/{}",
        baseline_qa.extractive_correct, baseline_qa.total
    );
    println!(
        "qa_extractive_correct_compacted_same_records={}/{}",
        compacted_same_coverage_qa.extractive_correct, compacted_same_coverage_qa.total
    );
    println!(
        "qa_extractive_correct_compacted={}/{}",
        compacted_qa.extractive_correct, compacted_qa.total
    );
    println!("qa_accuracy_gain_percentage_points={qa_gain_points:.2}");
    println!("qa_regressions_on_baseline_correct={qa_regressions}");
    println!("qa_same_coverage_regressions={same_coverage_regressions}");
    println!("gate_token_reduction={reduction_gate}");
    println!("gate_critical_retention={retention_gate}");
    println!("gate_metadata_integrity={metadata_gate}");
    println!("gate_reversibility={reversibility_gate}");
    println!("gate_p95_below_1ms={latency_gate}");
    println!("structural_experiment_passed={structural_passed}");
    println!("deterministic_qa_ab_passed={qa_gate}");
    println!(
        "integration_recommendation={}",
        if passed {
            "REAL_MODEL_AB_REQUIRED"
        } else {
            "REJECT"
        }
    );

    if !passed {
        std::process::exit(1);
    }
}

fn compact_capsule(capsule: &ContextCapsule) -> Vec<CompactedEntry> {
    capsule
        .entries
        .iter()
        .map(|original| {
            let content = if original.category == ContextCategory::ActiveGoal {
                normalize_whitespace(&original.content)
            } else {
                compact_content(&original.content, 1)
            };
            let estimated_tokens = ENTRY_OVERHEAD_TOKENS + estimate_tokens(&content);
            CompactedEntry {
                record_id: original.record_id.clone(),
                category: original.category,
                content,
                source_type: original.source_type.clone(),
                semantic_type: original.semantic_type.clone(),
                level: original.level,
                confidence: original.confidence,
                strength: original.strength,
                salience: original.salience,
                estimated_tokens,
                selection_reasons: original.selection_reasons.clone(),
            }
        })
        .collect()
}

fn compact_content(input: &str, duplicate_limit: usize) -> String {
    let mut seen = BTreeMap::new();
    let mut kept = Vec::new();

    for unit in split_units(input) {
        let normalized = normalize_whitespace(&unit);
        if normalized.is_empty() {
            continue;
        }

        let stripped = strip_boilerplate_prefix(&normalized);
        if stripped.is_empty() {
            continue;
        }

        let key: String = stripped
            .chars()
            .filter(|character| character.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();
        let occurrences = seen.entry(key).or_insert(0_usize);
        if *occurrences < duplicate_limit.max(1) {
            kept.push(stripped);
            *occurrences += 1;
        }
    }

    kept.join(" ")
}

fn split_units(input: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut current = String::new();
    let mut characters = input.chars().peekable();
    let mut previous = None;
    while let Some(character) = characters.next() {
        current.push(character);
        let numeric_period = character == '.'
            && previous.is_some_and(|value: char| value.is_ascii_digit())
            && characters
                .peek()
                .is_some_and(|value| value.is_ascii_digit());
        if matches!(character, '.' | '!' | '?' | ';' | '\n') && !numeric_period {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                units.push(trimmed.to_string());
            }
            current.clear();
        }
        previous = Some(character);
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        units.push(trimmed.to_string());
    }
    units
}

fn strip_boilerplate_prefix(unit: &str) -> String {
    const PREFIXES: &[&str] = &[
        "as previously mentioned, ",
        "for completeness, ",
        "generally speaking, ",
        "in other words, ",
        "it is important to note that ",
        "at this point in time, ",
    ];

    let lower = unit.to_lowercase();
    for prefix in PREFIXES {
        if lower.starts_with(prefix) {
            return unit[prefix.len()..].trim().to_string();
        }
    }
    unit.to_string()
}

fn normalize_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn estimate_tokens(value: &str) -> usize {
    value.chars().count().div_ceil(4).max(1)
}

fn entries_that_fit(tokens: impl Iterator<Item = usize>, budget: usize) -> usize {
    let mut used = 0;
    let mut count = 0;
    for entry_tokens in tokens {
        if used + entry_tokens > budget {
            break;
        }
        used += entry_tokens;
        count += 1;
    }
    count
}

fn metadata_is_unchanged(compacted: &CompactedEntry, original: &ContextCapsuleEntry) -> bool {
    compacted.record_id == original.record_id
        && compacted.category == original.category
        && compacted.source_type == original.source_type
        && compacted.semantic_type == original.semantic_type
        && compacted.level == original.level
        && compacted.confidence == original.confidence
        && compacted.strength == original.strength
        && compacted.salience == original.salience
        && compacted.selection_reasons == original.selection_reasons
}

fn expand_content<'a>(
    entry: &'a CompactedEntry,
    original_store: &BTreeMap<&'a str, &'a str>,
) -> Option<&'a str> {
    original_store.get(entry.record_id.as_str()).copied()
}

fn critical_span_retention(
    entries: &[CompactedEntry],
    required_spans: &BTreeMap<String, Vec<&'static str>>,
) -> (usize, usize) {
    let by_id: BTreeMap<&str, &str> = entries
        .iter()
        .map(|entry| (entry.record_id.as_str(), entry.content.as_str()))
        .collect();
    let required = required_spans.values().map(Vec::len).sum();
    let retained = required_spans
        .iter()
        .map(|(record_id, spans)| {
            by_id.get(record_id.as_str()).map_or(0, |content| {
                spans.iter().filter(|span| content.contains(**span)).count()
            })
        })
        .sum();
    (retained, required)
}

#[derive(Debug)]
struct LatencyDistribution {
    median_ns: u128,
    p95_ns: u128,
}

fn latency_distribution(capsule: &ContextCapsule) -> LatencyDistribution {
    let mut samples = Vec::with_capacity(ITERATIONS);
    for _ in 0..ITERATIONS {
        let started = Instant::now();
        black_box(compact_capsule(black_box(capsule)));
        samples.push(started.elapsed().as_nanos());
    }
    samples.sort_unstable();
    LatencyDistribution {
        median_ns: samples[samples.len() / 2],
        p95_ns: samples[samples.len() * 95 / 100],
    }
}

fn evaluate_qa(prompt: &[PromptEntry<'_>], probes: &[QaProbe]) -> QaScore {
    let mut answerable = 0;
    let mut extractive_correct = 0;
    let mut correct = Vec::with_capacity(probes.len());

    for probe in probes {
        let expected = probe.expected.to_lowercase();
        if prompt
            .iter()
            .any(|entry| entry.content.to_lowercase().contains(&expected))
        {
            answerable += 1;
        }
        let predicted = best_extractive_unit(prompt, probe.question);
        let is_correct = predicted
            .as_deref()
            .is_some_and(|unit| unit.to_lowercase().contains(&expected));
        if is_correct {
            extractive_correct += 1;
        }
        correct.push(is_correct);
    }

    QaScore {
        answerable,
        extractive_correct,
        total: probes.len(),
        correct,
    }
}

fn best_extractive_unit(prompt: &[PromptEntry<'_>], question: &str) -> Option<String> {
    let question_terms = qa_terms(question);
    prompt
        .iter()
        .flat_map(|entry| {
            split_units(entry.content)
                .into_iter()
                .map(move |unit| (entry.record_id, unit))
        })
        .map(|(record_id, unit)| {
            let unit_terms = qa_terms(&unit);
            let lexical_overlap = question_terms.intersection(&unit_terms).count();
            let id_bonus = record_id
                .split(|character: char| !character.is_alphanumeric())
                .filter(|part| part.chars().count() >= 2)
                .filter(|part| question.to_lowercase().contains(&part.to_lowercase()))
                .count();
            (lexical_overlap * 10 + id_bonus, unit)
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, unit)| unit)
}

fn qa_terms(value: &str) -> BTreeSet<String> {
    const STOPWORDS: &[&str] = &[
        "a",
        "an",
        "and",
        "according",
        "by",
        "does",
        "for",
        "from",
        "how",
        "in",
        "is",
        "of",
        "on",
        "the",
        "to",
        "was",
        "what",
        "when",
        "which",
        "with",
    ];
    value
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .map(str::to_lowercase)
        .filter(|part| part.chars().count() >= 2)
        .filter(|part| !STOPWORDS.contains(&part.as_str()))
        .collect()
}

fn qa_probes() -> Vec<QaProbe> {
    vec![
        QaProbe {
            question: "What caused the corrupted release in failure F-19?",
            expected: "Skipping signature verification",
        },
        QaProbe {
            question: "Which test failed on build 881?",
            expected: "release_signature_guard",
        },
        QaProbe {
            question: "What cache throughput is claimed by evidence debt ED-12?",
            expected: "10,000 writes per second",
        },
        QaProbe {
            question: "What confidence is recorded for evidence debt ED-12?",
            expected: "0.54",
        },
        QaProbe {
            question: "Which release must be prepared after Linux and Windows tests pass?",
            expected: "release 1.59.0",
        },
        QaProbe {
            question: "What is the deadline for active goal GOAL-31?",
            expected: "2026-09-04T18:00:00Z",
        },
        QaProbe {
            question: "What does the new claim in contradiction CON-77 require?",
            expected: "PostgreSQL 16",
        },
        QaProbe {
            question: "Which old PostgreSQL version must not be used for new deployments?",
            expected: "PostgreSQL 15",
        },
        QaProbe {
            question: "What deployment target was selected by decision DEC-1042?",
            expected: "production-eu-west",
        },
        QaProbe {
            question: "Which deployment target must the agent not use in decision DEC-1042?",
            expected: "production-us-east",
        },
        QaProbe {
            question: "What kind of component is Aura according to identity rule ID-4?",
            expected: "embedded cognitive memory component",
        },
        QaProbe {
            question: "Which service must core recall never require?",
            expected: "cloud service",
        },
        QaProbe {
            question: "When is answer permission blocked under domain constraint DOM-9?",
            expected: "decisive evidence is missing",
        },
        QaProbe {
            question: "What must not be converted into a fact?",
            expected: "evidence debt",
        },
        QaProbe {
            question: "Where should the exact original record be kept under MEM-22?",
            expected: "outside the compact prompt",
        },
        QaProbe {
            question: "How may the compact representation be expanded?",
            expected: "record ID",
        },
    ]
}

fn emit_model_ab(
    baseline: &[PromptEntry<'_>],
    compacted: &[PromptEntry<'_>],
    probes: &[QaProbe],
) -> std::io::Result<()> {
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("generated");
    fs::create_dir_all(&output)?;
    fs::write(output.join("context_baseline.txt"), render_prompt(baseline))?;
    fs::write(
        output.join("context_compacted.txt"),
        render_prompt(compacted),
    )?;

    let mut questions = String::from("id\tquestion\texpected\n");
    for (index, probe) in probes.iter().enumerate() {
        questions.push_str(&format!(
            "Q{:02}\t{}\t{}\n",
            index + 1,
            probe.question,
            probe.expected
        ));
    }
    fs::write(output.join("qa.tsv"), questions)?;
    println!("model_ab_fixtures={}", output.display());
    Ok(())
}

fn render_prompt(entries: &[PromptEntry<'_>]) -> String {
    let mut prompt = String::new();
    for entry in entries {
        prompt.push_str("[record_id=");
        prompt.push_str(entry.record_id);
        prompt.push_str("]\n");
        prompt.push_str(entry.content);
        prompt.push_str("\n\n");
    }
    prompt
}

fn fixture() -> Fixture {
    let cases = [
        (
            "decision-deploy",
            Level::Decisions,
            "decision",
            &["decision"] as &[&str],
            "Decision ID DEC-1042. The deployment target is production-eu-west. Source: change request CR-88. Valid from: 2026-08-30T09:00:00Z. The agent must not deploy to production-us-east. It is important to note that the deployment target is production-eu-west. As previously mentioned, the deployment target is production-eu-west. For completeness, the team reviewed several alternatives and discussed the matter at length. The deployment target is production-eu-west.",
            vec![
                "Decision ID DEC-1042",
                "The deployment target is production-eu-west",
                "Source: change request CR-88",
                "Valid from: 2026-08-30T09:00:00Z",
                "must not deploy to production-us-east",
            ],
        ),
        (
            "contradiction-db",
            Level::Working,
            "contradiction",
            &["contradiction"],
            "Contradiction ID CON-77. Old claim: PostgreSQL 15 is required. New claim: PostgreSQL 16 is required. Source old: handbook-v2. Source new: migration-214. Valid from: 2026-09-01T00:00:00Z. Do not use PostgreSQL 15 for new deployments. In other words, PostgreSQL 16 is required. As previously mentioned, PostgreSQL 16 is required. For completeness, the database version was discussed in multiple planning meetings. PostgreSQL 16 is required.",
            vec![
                "Contradiction ID CON-77",
                "Old claim: PostgreSQL 15 is required",
                "New claim: PostgreSQL 16 is required",
                "Source old: handbook-v2",
                "Source new: migration-214",
                "Do not use PostgreSQL 15",
            ],
        ),
        (
            "scar-signature",
            Level::Working,
            "fact",
            &[aura::consequence::CONSEQUENCE_REFUTE_TAG],
            "Failure F-19. Skipping signature verification caused a corrupted release. Evidence: test release_signature_guard failed on build 881. Never publish when signature verification is missing. It is important to note that skipping signature verification caused a corrupted release. As previously mentioned, never publish when signature verification is missing. For completeness, multiple team members later discussed this failed release. Skipping signature verification caused a corrupted release.",
            vec![
                "Failure F-19",
                "Skipping signature verification caused a corrupted release",
                "Evidence: test release_signature_guard failed on build 881",
                "Never publish when signature verification is missing",
            ],
        ),
        (
            "debt-cache",
            Level::Working,
            "fact",
            &["consequence-inconclusive"],
            "Evidence debt ED-12 remains open. Claim: the cache is safe at 10,000 writes per second. Source: synthetic load test only. Confidence: 0.54. Do not promote this claim until an independent test passes. Generally speaking, the cache is expected to work well under load. For completeness, the team has discussed cache performance several times. As previously mentioned, the cache is safe at 10,000 writes per second. The cache is safe at 10,000 writes per second.",
            vec![
                "Evidence debt ED-12 remains open",
                "Claim: the cache is safe at 10,000 writes per second",
                "Source: synthetic load test only",
                "Confidence: 0.54",
                "Do not promote this claim until an independent test passes",
            ],
        ),
        (
            "goal-release",
            Level::Working,
            "fact",
            &["goal"],
            "Active goal GOAL-31. Prepare release 1.59.0 after all Linux and Windows tests pass. Owner: release-agent. Deadline: 2026-09-04T18:00:00Z. The release must not proceed after a failed test. As previously mentioned, prepare release 1.59.0 after all Linux and Windows tests pass. For completeness, release preparation includes routine documentation and packaging work. It is important to note that all Linux and Windows tests must pass. Prepare release 1.59.0 after all Linux and Windows tests pass.",
            vec![
                "Active goal GOAL-31",
                "Prepare release 1.59.0 after all Linux and Windows tests pass",
                "Owner: release-agent",
                "Deadline: 2026-09-04T18:00:00Z",
                "must not proceed after a failed test",
            ],
        ),
        (
            "identity-local",
            Level::Identity,
            "preference",
            &[],
            "Identity rule ID-4. Aura is an embedded cognitive memory component, not an agent runtime. Source: product charter. Never require a cloud service for core recall. In other words, Aura is an embedded cognitive memory component, not an agent runtime. As previously mentioned, never require a cloud service for core recall. For completeness, this positioning has been discussed throughout the product's development. Aura is an embedded cognitive memory component, not an agent runtime.",
            vec![
                "Identity rule ID-4",
                "Aura is an embedded cognitive memory component, not an agent runtime",
                "Source: product charter",
                "Never require a cloud service for core recall",
            ],
        ),
        (
            "domain-permission",
            Level::Domain,
            "fact",
            &[],
            "Domain constraint DOM-9. Answer permission is blocked when decisive evidence is missing. Source: evidence governance specification. Valid until: replaced by a verified policy. Do not convert evidence debt into a fact. It is important to note that answer permission is blocked when decisive evidence is missing. For completeness, the policy applies across every namespace. As previously mentioned, do not convert evidence debt into a fact. Answer permission is blocked when decisive evidence is missing.",
            vec![
                "Domain constraint DOM-9",
                "Answer permission is blocked when decisive evidence is missing",
                "Source: evidence governance specification",
                "Valid until: replaced by a verified policy",
                "Do not convert evidence debt into a fact",
            ],
        ),
        (
            "memory-policy",
            Level::Working,
            "fact",
            &[],
            "Memory policy MEM-22. Keep the exact original record outside the compact prompt. Source: context capsule experiment protocol. The compact representation may be expanded by record ID. Never overwrite the original memory with compressed text. As previously mentioned, keep the exact original record outside the compact prompt. For completeness, reversible access is useful for audits and detailed follow-up questions. It is important to note that the representation may be expanded by record ID. Keep the exact original record outside the compact prompt.",
            vec![
                "Memory policy MEM-22",
                "Keep the exact original record outside the compact prompt",
                "Source: context capsule experiment protocol",
                "may be expanded by record ID",
                "Never overwrite the original memory with compressed text",
            ],
        ),
    ];

    let mut records = Vec::new();
    let mut required_spans = BTreeMap::new();
    for (index, (id, level, semantic_type, tags, content, spans)) in cases.into_iter().enumerate() {
        let mut record = Record::new(content.to_string(), level);
        record.id = id.to_string();
        record.namespace = "experiment".to_string();
        record.semantic_type = semantic_type.to_string();
        record.source_type = "recorded".to_string();
        record.tags = tags.iter().map(|tag| (*tag).to_string()).collect();
        record.created_at = 1_700_000_000.0 + index as f64;
        record.last_activated = record.created_at;
        record.salience = 0.8;
        required_spans.insert(id.to_string(), spans);
        records.push(record);
    }

    Fixture {
        records,
        required_spans,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_duplicates_and_boilerplate_are_removed() {
        let input = "Keep fact A. As previously mentioned, keep fact A. Keep fact A.";
        assert_eq!(compact_content(input, 1), "Keep fact A.");
    }

    #[test]
    fn decimals_and_versions_remain_whole() {
        let input = "Confidence: 0.54. Release 1.59.0 is ready.";
        assert_eq!(
            split_units(input),
            vec!["Confidence: 0.54.", "Release 1.59.0 is ready."]
        );
    }

    #[test]
    fn required_fixture_spans_survive() {
        let fixture = fixture();
        let capsule = build_context_capsule_at(
            &fixture.records,
            "experiment",
            "prepare secure production deployment release cache memory",
            32_768,
            1_800_000_000.0,
        );
        let compacted = compact_capsule(&capsule);
        let (retained, required) = critical_span_retention(&compacted, &fixture.required_spans);
        assert_eq!(retained, required);
    }

    #[test]
    fn fixed_budget_qa_improves_without_same_coverage_regression() {
        let fixture = fixture();
        let capsule = build_context_capsule_at(
            &fixture.records,
            "experiment",
            "prepare secure production deployment release cache memory",
            32_768,
            1_800_000_000.0,
        );
        let compacted = compact_capsule(&capsule);
        let baseline_fit = entries_that_fit(
            capsule.entries.iter().map(|entry| entry.estimated_tokens),
            TARGET_BUDGET,
        );
        let compacted_fit = entries_that_fit(
            compacted.iter().map(|entry| entry.estimated_tokens),
            TARGET_BUDGET,
        );
        let baseline_prompt: Vec<_> = capsule
            .entries
            .iter()
            .take(baseline_fit)
            .map(|entry| PromptEntry {
                record_id: &entry.record_id,
                content: &entry.content,
            })
            .collect();
        let same_coverage_prompt: Vec<_> = compacted
            .iter()
            .take(baseline_fit)
            .map(|entry| PromptEntry {
                record_id: &entry.record_id,
                content: &entry.content,
            })
            .collect();
        let compacted_prompt: Vec<_> = compacted
            .iter()
            .take(compacted_fit)
            .map(|entry| PromptEntry {
                record_id: &entry.record_id,
                content: &entry.content,
            })
            .collect();
        let probes = qa_probes();
        let baseline = evaluate_qa(&baseline_prompt, &probes);
        let same_coverage = evaluate_qa(&same_coverage_prompt, &probes);
        let compacted_score = evaluate_qa(&compacted_prompt, &probes);

        assert_eq!(same_coverage.correct, baseline.correct);
        assert!(compacted_score.extractive_correct > baseline.extractive_correct);
    }
}
