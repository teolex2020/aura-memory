use aura::{
    admission_decision, verify_lineage, AdmissionDecision, AnswerPermission, EvidenceClaim,
    SourceDocument, SourceSpan, VerificationStatus,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::hint::black_box;
use std::path::Path;
use std::time::Instant;

const ITERATIONS: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
enum MemoryBucket {
    Timeline,
    Graph,
    Documentary,
}

#[derive(Debug)]
struct EvidenceItem {
    id: String,
    bucket: MemoryBucket,
    content: String,
    source_bytes: Vec<u8>,
    document: SourceDocument,
    claim: EvidenceClaim,
    support_keys: BTreeSet<String>,
}

impl EvidenceItem {
    fn admission(&self) -> AdmissionDecision {
        let integrity = verify_lineage(&self.document, &self.source_bytes, &self.claim.lineage);
        admission_decision(&self.claim, &integrity)
    }
}

#[derive(Debug, Clone)]
struct QueryCase {
    id: &'static str,
    question: &'static str,
    expected_answer: &'static str,
    expected_route: Vec<MemoryBucket>,
    candidate_ids: Vec<&'static str>,
    opened_ids: Vec<&'static str>,
    required_citations: Vec<&'static str>,
    proposal: ProposedAnswer,
}

#[derive(Debug, Clone)]
struct ProposedAnswer {
    answer: &'static str,
    citations: Vec<&'static str>,
    atomic_claim_keys: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EpisodeDecision {
    Allow,
    Abstain(&'static str),
}

#[derive(Debug)]
struct RetrievalEpisode<'a> {
    route: Vec<MemoryBucket>,
    candidates: BTreeSet<&'a str>,
    opened: BTreeSet<&'a str>,
}

impl<'a> RetrievalEpisode<'a> {
    fn for_case(case: &'a QueryCase) -> Self {
        Self {
            route: route_query(case.question),
            candidates: case.candidate_ids.iter().copied().collect(),
            opened: case.opened_ids.iter().copied().collect(),
        }
    }

    fn finalize_baseline(&self, proposal: &ProposedAnswer) -> EpisodeDecision {
        if proposal.answer.eq_ignore_ascii_case("UNKNOWN") {
            return EpisodeDecision::Allow;
        }
        if proposal.citations.is_empty() {
            return EpisodeDecision::Abstain("missing_citation");
        }
        if proposal
            .citations
            .iter()
            .any(|citation| !self.candidates.contains(citation))
        {
            return EpisodeDecision::Abstain("citation_not_retrieved");
        }
        EpisodeDecision::Allow
    }

    fn finalize_locked(
        &self,
        proposal: &ProposedAnswer,
        evidence: &BTreeMap<String, EvidenceItem>,
    ) -> EpisodeDecision {
        if proposal.answer.eq_ignore_ascii_case("UNKNOWN") {
            return EpisodeDecision::Allow;
        }
        if proposal.citations.is_empty() {
            return EpisodeDecision::Abstain("missing_citation");
        }

        let mut supported = BTreeSet::new();
        for citation in &proposal.citations {
            if !self.opened.contains(citation) {
                return EpisodeDecision::Abstain("citation_not_opened");
            }
            let Some(item) = evidence.get(*citation) else {
                return EpisodeDecision::Abstain("unknown_evidence");
            };
            if !self.route.contains(&item.bucket) {
                return EpisodeDecision::Abstain("evidence_outside_route");
            }
            if item.admission() != AdmissionDecision::Cite {
                return EpisodeDecision::Abstain("evidence_not_citable");
            }
            supported.extend(item.support_keys.iter().cloned());
        }

        if proposal
            .atomic_claim_keys
            .iter()
            .any(|claim| !supported.contains(*claim))
        {
            return EpisodeDecision::Abstain("atomic_claim_unsupported");
        }
        EpisodeDecision::Allow
    }
}

#[derive(Debug, Serialize)]
struct ModelCase {
    id: String,
    question: String,
    expected_answer: String,
    answerable: bool,
    required_citations: Vec<String>,
    baseline_context: String,
    locked_context: String,
    baseline_allowed_citations: Vec<String>,
    locked_allowed_citations: Vec<String>,
}

#[derive(Debug)]
struct StructuralMetrics {
    baseline_unsafe_allowed: usize,
    locked_unsafe_allowed: usize,
    valid_answers: usize,
    valid_answers_preserved: usize,
    expected_abstentions: usize,
    locked_abstentions: usize,
    router_correct: usize,
    total_cases: usize,
    baseline_context_tokens: usize,
    locked_context_tokens: usize,
    median_ns: u128,
    p95_ns: u128,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let evidence = fixture_evidence()?;
    let cases = fixture_cases();
    let metrics = evaluate_structural(&cases, &evidence);
    emit_model_cases(&cases, &evidence)?;

    println!("cases={}", metrics.total_cases);
    println!(
        "router_correct={}/{}",
        metrics.router_correct, metrics.total_cases
    );
    println!(
        "unsafe_answers_allowed={} -> {}",
        metrics.baseline_unsafe_allowed, metrics.locked_unsafe_allowed
    );
    println!(
        "valid_answers_preserved={}/{}",
        metrics.valid_answers_preserved, metrics.valid_answers
    );
    println!(
        "required_abstentions={}/{}",
        metrics.locked_abstentions, metrics.expected_abstentions
    );
    println!(
        "model_context_tokens={} -> {}",
        metrics.baseline_context_tokens, metrics.locked_context_tokens
    );
    println!(
        "finalize_median_ms={:.4}",
        metrics.median_ns as f64 / 1_000_000.0
    );
    println!("finalize_p95_ms={:.4}", metrics.p95_ns as f64 / 1_000_000.0);

    let passed = metrics.locked_unsafe_allowed == 0
        && metrics.valid_answers_preserved == metrics.valid_answers
        && metrics.locked_abstentions == metrics.expected_abstentions
        && metrics.router_correct == metrics.total_cases
        && metrics.p95_ns < 1_000_000;
    println!("acceptance_gate={}", passed);
    if !passed {
        return Err("citation-lock structural acceptance gate failed".into());
    }
    Ok(())
}

fn evaluate_structural(
    cases: &[QueryCase],
    evidence: &BTreeMap<String, EvidenceItem>,
) -> StructuralMetrics {
    let mut baseline_unsafe_allowed = 0;
    let mut locked_unsafe_allowed = 0;
    let mut valid_answers = 0;
    let mut valid_answers_preserved = 0;
    let mut expected_abstentions = 0;
    let mut locked_abstentions = 0;
    let mut router_correct = 0;
    let mut baseline_context_tokens = 0;
    let mut locked_context_tokens = 0;

    for case in cases {
        let episode = RetrievalEpisode::for_case(case);
        if episode.route == case.expected_route {
            router_correct += 1;
        }
        let baseline = episode.finalize_baseline(&case.proposal);
        let locked = episode.finalize_locked(&case.proposal, evidence);
        baseline_context_tokens +=
            estimated_tokens(&render_context(&case.candidate_ids, evidence, false));
        let admissible_opened: Vec<_> = case
            .opened_ids
            .iter()
            .filter(|id| {
                evidence
                    .get(**id)
                    .is_some_and(|item| item.admission() == AdmissionDecision::Cite)
            })
            .copied()
            .collect();
        locked_context_tokens +=
            estimated_tokens(&render_context(&admissible_opened, evidence, true));
        let should_allow = !case.required_citations.is_empty();
        if should_allow {
            valid_answers += 1;
            if locked == EpisodeDecision::Allow {
                valid_answers_preserved += 1;
            }
        } else {
            expected_abstentions += 1;
            if baseline == EpisodeDecision::Allow {
                baseline_unsafe_allowed += 1;
            }
            if locked == EpisodeDecision::Allow {
                locked_unsafe_allowed += 1;
            } else {
                locked_abstentions += 1;
            }
        }
    }

    let mut samples = Vec::with_capacity(ITERATIONS);
    for index in 0..ITERATIONS {
        let case = &cases[index % cases.len()];
        let episode = RetrievalEpisode::for_case(case);
        let started = Instant::now();
        black_box(episode.finalize_locked(black_box(&case.proposal), black_box(evidence)));
        samples.push(started.elapsed().as_nanos());
    }
    samples.sort_unstable();

    StructuralMetrics {
        baseline_unsafe_allowed,
        locked_unsafe_allowed,
        valid_answers,
        valid_answers_preserved,
        expected_abstentions,
        locked_abstentions,
        router_correct,
        total_cases: cases.len(),
        baseline_context_tokens,
        locked_context_tokens,
        median_ns: samples[samples.len() / 2],
        p95_ns: samples[samples.len() * 95 / 100],
    }
}

fn route_query(question: &str) -> Vec<MemoryBucket> {
    let normalized = question.to_ascii_lowercase();
    if ["calculate ", "translate ", "rewrite "]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        return Vec::new();
    }

    let timeline = [
        "when", "latest", "current", "changed", "date", "budget", "version", "timezone",
    ]
    .iter()
    .any(|term| normalized.contains(term));
    let graph = [
        "related",
        "relationship",
        "leads",
        "which project",
        "produced",
        "verified by",
    ]
    .iter()
    .any(|term| normalized.contains(term));
    let documentary = [
        "prefer",
        "preference",
        "policy",
        "codename",
        "error code",
        "office",
        "team size",
        "compliance",
    ]
    .iter()
    .any(|term| normalized.contains(term));

    let mut route = Vec::new();
    if timeline {
        route.push(MemoryBucket::Timeline);
    }
    if graph {
        route.push(MemoryBucket::Graph);
    }
    if documentary {
        route.push(MemoryBucket::Documentary);
    }
    if route.is_empty() {
        route.extend([
            MemoryBucket::Timeline,
            MemoryBucket::Graph,
            MemoryBucket::Documentary,
        ]);
    }
    route
}

fn evidence_item(
    id: &str,
    bucket: MemoryBucket,
    content: &str,
    support_keys: &[&str],
    status: VerificationStatus,
    permission: AnswerPermission,
    tamper_source: bool,
) -> Result<EvidenceItem, Box<dyn std::error::Error>> {
    let original = content.as_bytes().to_vec();
    let document = SourceDocument::from_bytes(
        format!("doc-{id}"),
        "rev-1",
        format!("memory://experiment/{id}"),
        &original,
    );
    let span = SourceSpan::from_document(&document, &original, 0, original.len())?;
    let mut source_bytes = original;
    if tamper_source {
        source_bytes.push(b'!');
    }
    Ok(EvidenceItem {
        id: id.to_string(),
        bucket,
        content: content.to_string(),
        source_bytes,
        document,
        claim: EvidenceClaim {
            claim_id: format!("claim-{id}"),
            record_id: id.to_string(),
            claim_text: content.to_string(),
            lineage: span,
            verification_status: status,
            answer_permission: permission,
            confidence: 0.95,
            supporting_lineage_groups: Vec::new(),
            conflicting_claim_ids: Vec::new(),
            evidence_debt: Vec::new(),
        },
        support_keys: support_keys.iter().map(|key| (*key).to_string()).collect(),
    })
}

fn fixture_evidence() -> Result<BTreeMap<String, EvidenceItem>, Box<dyn std::error::Error>> {
    let specs = [
        (
            "launch-old",
            MemoryBucket::Timeline,
            "On 2026-08-01 the launch date was September 10.",
            &["launch-date-old"] as &[&str],
            VerificationStatus::Superseded,
            AnswerPermission::Cite,
            false,
        ),
        (
            "launch-current",
            MemoryBucket::Timeline,
            "On 2026-08-20 the launch date changed to September 24.",
            &["launch-date-current"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "budget-old",
            MemoryBucket::Timeline,
            "The original Atlas budget was $1.2 million.",
            &["budget-old"],
            VerificationStatus::Superseded,
            AnswerPermission::Cite,
            false,
        ),
        (
            "budget-current",
            MemoryBucket::Timeline,
            "The current Atlas budget is $950,000 after the August review.",
            &["budget-current"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "db-old",
            MemoryBucket::Timeline,
            "Deployment policy version 4 required PostgreSQL 15.",
            &["db-old"],
            VerificationStatus::Superseded,
            AnswerPermission::Cite,
            false,
        ),
        (
            "db-current",
            MemoryBucket::Timeline,
            "Deployment policy version 5 requires PostgreSQL 16.",
            &["db-current"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "alice-atlas",
            MemoryBucket::Graph,
            "Alice leads project Atlas.",
            &["alice-leads-atlas"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "atlas-rust",
            MemoryBucket::Graph,
            "Project Atlas uses Rust for its memory engine.",
            &["atlas-uses-rust"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "artifact-wheel",
            MemoryBucket::Graph,
            "Decision D-41 produced artifact aura_memory-1.59.0.whl.",
            &["decision-produced-wheel"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "wheel-test",
            MemoryBucket::Graph,
            "Artifact aura_memory-1.59.0.whl was verified by python_wheel_smoke.",
            &["wheel-verified-by-test"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "theme",
            MemoryBucket::Documentary,
            "The user prefers dark mode for development tools.",
            &["theme-dark"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "codename",
            MemoryBucket::Documentary,
            "The internal codename for the memory project is Aurora.",
            &["codename-aurora"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "error-auth",
            MemoryBucket::Documentary,
            "The token exchange failure uses error code ERR_AUTH_431.",
            &["error-auth-431"],
            VerificationStatus::Corroborated,
            AnswerPermission::Cite,
            false,
        ),
        (
            "timezone-old",
            MemoryBucket::Timeline,
            "The account timezone was Europe/London.",
            &["timezone-old"],
            VerificationStatus::Superseded,
            AnswerPermission::Cite,
            false,
        ),
        (
            "timezone-current",
            MemoryBucket::Timeline,
            "The current account timezone is Europe/Kyiv.",
            &["timezone-current"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            false,
        ),
        (
            "region-eu",
            MemoryBucket::Documentary,
            "The deployment region is eu-west-1.",
            &["region-eu"],
            VerificationStatus::Contested,
            AnswerPermission::Cite,
            false,
        ),
        (
            "region-us",
            MemoryBucket::Documentary,
            "The deployment region is us-east-1.",
            &["region-us"],
            VerificationStatus::Contested,
            AnswerPermission::Cite,
            false,
        ),
        (
            "team-size",
            MemoryBucket::Documentary,
            "An unverified inference estimates the team size at 12.",
            &["team-size-12"],
            VerificationStatus::Candidate,
            AnswerPermission::ContextOnly,
            false,
        ),
        (
            "compliance",
            MemoryBucket::Documentary,
            "The compliance review passed without findings.",
            &["compliance-passed"],
            VerificationStatus::Verified,
            AnswerPermission::Cite,
            true,
        ),
        (
            "office-hint",
            MemoryBucket::Documentary,
            "A generated guess says the office may be room 704.",
            &["office-704"],
            VerificationStatus::Candidate,
            AnswerPermission::Blocked,
            false,
        ),
    ];

    let mut items = BTreeMap::new();
    for (id, bucket, content, keys, status, permission, tamper) in specs {
        let item = evidence_item(id, bucket, content, keys, status, permission, tamper)?;
        items.insert(id.to_string(), item);
    }
    Ok(items)
}

fn fixture_cases() -> Vec<QueryCase> {
    vec![
        case(
            "temporal-launch",
            "What is the current launch date?",
            "September 24",
            vec![MemoryBucket::Timeline],
            vec!["launch-old", "launch-current"],
            vec!["launch-current"],
            vec!["launch-current"],
            "September 24",
            vec!["launch-current"],
            vec!["launch-date-current"],
        ),
        case(
            "temporal-budget",
            "What is the current Atlas budget?",
            "$950,000",
            vec![MemoryBucket::Timeline],
            vec!["budget-old", "budget-current"],
            vec!["budget-current"],
            vec!["budget-current"],
            "$950,000",
            vec!["budget-current"],
            vec!["budget-current"],
        ),
        case(
            "temporal-db",
            "Which database version does the current deployment policy require?",
            "PostgreSQL 16",
            vec![MemoryBucket::Timeline, MemoryBucket::Documentary],
            vec!["db-old", "db-current"],
            vec!["db-current"],
            vec!["db-current"],
            "PostgreSQL 16",
            vec!["db-current"],
            vec!["db-current"],
        ),
        case(
            "graph-owner-language",
            "Which project does Alice lead and what language does it use?",
            "Atlas|Rust",
            vec![MemoryBucket::Graph],
            vec!["alice-atlas", "atlas-rust", "theme"],
            vec!["alice-atlas", "atlas-rust"],
            vec!["alice-atlas", "atlas-rust"],
            "Alice leads Atlas, which uses Rust",
            vec!["alice-atlas", "atlas-rust"],
            vec!["alice-leads-atlas", "atlas-uses-rust"],
        ),
        case(
            "graph-verification",
            "Which artifact was produced by D-41 and what was it verified by?",
            "aura_memory-1.59.0.whl|python_wheel_smoke",
            vec![MemoryBucket::Graph],
            vec!["artifact-wheel", "wheel-test", "error-auth"],
            vec!["artifact-wheel", "wheel-test"],
            vec!["artifact-wheel", "wheel-test"],
            "aura_memory-1.59.0.whl; python_wheel_smoke",
            vec!["artifact-wheel", "wheel-test"],
            vec!["decision-produced-wheel", "wheel-verified-by-test"],
        ),
        case(
            "document-theme",
            "Which interface theme does the user prefer?",
            "dark mode",
            vec![MemoryBucket::Documentary],
            vec!["theme", "codename"],
            vec!["theme"],
            vec!["theme"],
            "dark mode",
            vec!["theme"],
            vec!["theme-dark"],
        ),
        case(
            "document-codename",
            "What is the project codename?",
            "Aurora",
            vec![MemoryBucket::Documentary],
            vec!["codename", "alice-atlas"],
            vec!["codename"],
            vec!["codename"],
            "Aurora",
            vec!["codename"],
            vec!["codename-aurora"],
        ),
        case(
            "document-error",
            "What exact error code identifies the token exchange failure?",
            "ERR_AUTH_431",
            vec![MemoryBucket::Documentary],
            vec!["error-auth", "artifact-wheel"],
            vec!["error-auth"],
            vec!["error-auth"],
            "ERR_AUTH_431",
            vec!["error-auth"],
            vec!["error-auth-431"],
        ),
        case(
            "temporal-timezone",
            "What is the current account timezone?",
            "Europe/Kyiv",
            vec![MemoryBucket::Timeline],
            vec!["timezone-old", "timezone-current"],
            vec!["timezone-current"],
            vec!["timezone-current"],
            "Europe/Kyiv",
            vec!["timezone-current"],
            vec!["timezone-current"],
        ),
        case(
            "unanswerable-office",
            "What is the user's office number?",
            "UNKNOWN",
            vec![MemoryBucket::Documentary],
            vec!["office-hint", "theme"],
            vec![],
            vec![],
            "room 704",
            vec!["office-hint"],
            vec!["office-704"],
        ),
        case(
            "context-only-team",
            "What is the confirmed team size?",
            "UNKNOWN",
            vec![MemoryBucket::Documentary],
            vec!["team-size", "codename"],
            vec![],
            vec![],
            "12",
            vec!["team-size"],
            vec!["team-size-12"],
        ),
        case(
            "tampered-compliance",
            "Did the compliance review pass?",
            "UNKNOWN",
            vec![MemoryBucket::Documentary],
            vec!["compliance", "theme"],
            vec![],
            vec![],
            "Yes",
            vec!["compliance"],
            vec!["compliance-passed"],
        ),
        case(
            "contested-region",
            "What is the deployment region?",
            "UNKNOWN",
            vec![
                MemoryBucket::Timeline,
                MemoryBucket::Graph,
                MemoryBucket::Documentary,
            ],
            vec!["region-eu", "region-us"],
            vec![],
            vec![],
            "eu-west-1",
            vec!["region-eu"],
            vec!["region-eu"],
        ),
        case(
            "unopened-citation",
            "What theme is preferred?",
            "UNKNOWN",
            vec![MemoryBucket::Documentary],
            vec!["theme", "codename"],
            vec!["codename"],
            vec![],
            "dark mode",
            vec!["theme"],
            vec!["theme-dark"],
        ),
        case(
            "unsupported-atomic",
            "What is the project codename and its launch date?",
            "UNKNOWN",
            vec![MemoryBucket::Timeline, MemoryBucket::Documentary],
            vec!["codename", "launch-current"],
            vec!["codename"],
            vec![],
            "Aurora launches September 24",
            vec!["codename"],
            vec!["codename-aurora", "launch-date-current"],
        ),
    ]
}

#[allow(clippy::too_many_arguments)]
fn case(
    id: &'static str,
    question: &'static str,
    expected_answer: &'static str,
    expected_route: Vec<MemoryBucket>,
    candidate_ids: Vec<&'static str>,
    opened_ids: Vec<&'static str>,
    required_citations: Vec<&'static str>,
    answer: &'static str,
    citations: Vec<&'static str>,
    atomic_claim_keys: Vec<&'static str>,
) -> QueryCase {
    QueryCase {
        id,
        question,
        expected_answer,
        expected_route,
        candidate_ids,
        opened_ids,
        required_citations,
        proposal: ProposedAnswer {
            answer,
            citations,
            atomic_claim_keys,
        },
    }
}

fn emit_model_cases(
    cases: &[QueryCase],
    evidence: &BTreeMap<String, EvidenceItem>,
) -> Result<(), Box<dyn std::error::Error>> {
    let model_cases: Vec<_> = cases
        .iter()
        .map(|case| {
            let locked_ids: Vec<_> = case
                .opened_ids
                .iter()
                .filter(|id| {
                    evidence
                        .get(**id)
                        .is_some_and(|item| item.admission() == AdmissionDecision::Cite)
                })
                .copied()
                .collect();
            ModelCase {
                id: case.id.to_string(),
                question: case.question.to_string(),
                expected_answer: case.expected_answer.to_string(),
                answerable: !case.required_citations.is_empty(),
                required_citations: case
                    .required_citations
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                baseline_context: render_context(&case.candidate_ids, evidence, false),
                locked_context: render_context(&locked_ids, evidence, true),
                baseline_allowed_citations: case
                    .candidate_ids
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
                locked_allowed_citations: locked_ids.iter().map(|id| (*id).to_string()).collect(),
            }
        })
        .collect();

    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("generated");
    fs::create_dir_all(&output)?;
    fs::write(
        output.join("cases.json"),
        serde_json::to_vec_pretty(&model_cases)?,
    )?;
    println!("model_ab_fixtures={}", output.display());
    Ok(())
}

fn render_context(ids: &[&str], evidence: &BTreeMap<String, EvidenceItem>, locked: bool) -> String {
    if ids.is_empty() {
        return "NO ADMISSIBLE MEMORY EVIDENCE".to_string();
    }
    let mut output = String::new();
    for id in ids {
        if let Some(item) = evidence.get(*id) {
            output.push_str(&format!(
                "[record_id={}; bucket={:?}{}]\n{}\n\n",
                item.id,
                item.bucket,
                if locked {
                    "; opened=true; citable=true"
                } else {
                    ""
                },
                item.content
            ));
        }
    }
    output
}

fn estimated_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citation_lock_blocks_every_unsafe_fixture() {
        let evidence = fixture_evidence().unwrap();
        let cases = fixture_cases();
        let metrics = evaluate_structural(&cases, &evidence);
        assert!(metrics.baseline_unsafe_allowed > 0);
        assert_eq!(metrics.locked_unsafe_allowed, 0);
        assert_eq!(metrics.locked_abstentions, metrics.expected_abstentions);
    }

    #[test]
    fn citation_lock_preserves_every_valid_fixture_answer() {
        let evidence = fixture_evidence().unwrap();
        let cases = fixture_cases();
        let metrics = evaluate_structural(&cases, &evidence);
        assert_eq!(metrics.valid_answers_preserved, metrics.valid_answers);
    }

    #[test]
    fn router_matches_declared_buckets() {
        for case in fixture_cases() {
            assert_eq!(
                route_query(case.question),
                case.expected_route,
                "{}",
                case.id
            );
        }
        assert!(route_query("Calculate 17 + 25").is_empty());
    }

    #[test]
    fn source_tampering_is_not_citable() {
        let evidence = fixture_evidence().unwrap();
        assert_eq!(evidence["compliance"].admission(), AdmissionDecision::Block);
    }
}
