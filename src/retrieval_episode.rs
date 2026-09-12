//! Episode-scoped citation locking for memory-backed answers.
//!
//! A retrieval episode is an ephemeral read model. It records which candidates
//! were retrieved, which evidence was actually opened, and which atomic answer
//! claims that opened evidence supports. It never mutates stored memory.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

use crate::evidence::{
    admission_decision, verify_lineage, AdmissionDecision, EvidenceClaim, SourceDocument,
};

#[cfg(feature = "python")]
use pyo3::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryRoute {
    Timeline,
    Graph,
    Documentary,
}

impl MemoryRoute {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Timeline => "timeline",
            Self::Graph => "graph",
            Self::Documentary => "documentary",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "timeline" | "temporal" | "event" | "events" => Some(Self::Timeline),
            "graph" | "entity_graph" | "entity-graph" => Some(Self::Graph),
            "documentary" | "document" | "semantic" | "profile" => Some(Self::Documentary),
            _ => None,
        }
    }

    pub fn all() -> Vec<Self> {
        vec![Self::Timeline, Self::Graph, Self::Documentary]
    }
}

/// Advisory, deterministic routing result. Hosts may override these routes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryIntent {
    pub needs_memory: bool,
    pub suggested_routes: Vec<MemoryRoute>,
    pub reason: String,
}

/// Conservatively suggest whether and where a host should query memory.
///
/// This function is intentionally advisory. Unknown memory questions route to
/// all buckets rather than risking a false negative.
pub fn suggest_memory_intent(query: &str) -> MemoryIntent {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return MemoryIntent {
            needs_memory: false,
            suggested_routes: Vec::new(),
            reason: "empty_query".into(),
        };
    }

    let refers_to_memory = [
        " previous ",
        " earlier ",
        " my ",
        " our ",
        " saved ",
        " memory ",
        " discussed ",
        " decided ",
    ]
    .iter()
    .any(|term| format!(" {normalized} ").contains(term));
    if !refers_to_memory
        && ["calculate ", "translate ", "rewrite "]
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
    {
        return MemoryIntent {
            needs_memory: false,
            suggested_routes: Vec::new(),
            reason: "self_contained_turn".into(),
        };
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

    let mut routes = Vec::new();
    if timeline {
        routes.push(MemoryRoute::Timeline);
    }
    if graph {
        routes.push(MemoryRoute::Graph);
    }
    if documentary {
        routes.push(MemoryRoute::Documentary);
    }
    if routes.is_empty() {
        routes = MemoryRoute::all();
        return MemoryIntent {
            needs_memory: true,
            suggested_routes: routes,
            reason: "conservative_all_routes".into(),
        };
    }

    MemoryIntent {
        needs_memory: true,
        suggested_routes: routes,
        reason: "query_signal_routes".into(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenedEvidenceReceipt {
    pub record_id: String,
    pub claim_id: String,
    pub route: MemoryRoute,
    pub admission: AdmissionDecision,
    pub integrity_valid: bool,
    pub document_id: String,
    pub revision_id: String,
    pub span_hash: String,
    pub support_keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceOpenResult {
    pub receipt: OpenedEvidenceReceipt,
    pub citable: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CitationLockDecision {
    Allow,
    Abstain,
    Block,
}

impl CitationLockDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Abstain => "abstain",
            Self::Block => "block",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CitationLockReport {
    pub episode_id: String,
    pub decision: CitationLockDecision,
    pub answer_permitted: bool,
    pub reasons: Vec<String>,
    pub citations: Vec<String>,
    pub opened_record_ids: Vec<String>,
    pub unsupported_claim_keys: Vec<String>,
    pub unused_opened_record_ids: Vec<String>,
    pub all_citations_opened: bool,
    pub all_citations_citable: bool,
    pub all_claims_supported: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RetrievalEpisodeError {
    #[error("query must not be empty")]
    EmptyQuery,
    #[error("record '{0}' was not a retrieval candidate")]
    RecordNotCandidate(String),
    #[error("route '{0}' is not enabled for this retrieval episode")]
    RouteNotEnabled(String),
    #[error("record '{0}' was already opened in this retrieval episode")]
    DuplicateOpenedRecord(String),
    #[error("evidence claim ID must not be empty")]
    EmptyClaimId,
    #[error("support keys must not contain an empty value")]
    EmptySupportKey,
}

/// Ephemeral audit state for one memory-backed answer.
#[cfg_attr(feature = "python", pyclass)]
#[derive(Debug, Clone, Serialize)]
pub struct RetrievalEpisode {
    episode_id: String,
    query: String,
    routes: Vec<MemoryRoute>,
    candidates: BTreeSet<String>,
    opened: BTreeMap<String, OpenedEvidenceReceipt>,
}

impl RetrievalEpisode {
    /// Start an episode using all memory routes. This is the conservative path.
    pub fn new<I, S>(
        query: impl Into<String>,
        candidate_ids: I,
    ) -> Result<Self, RetrievalEpisodeError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self::with_routes(query, candidate_ids, MemoryRoute::all())
    }

    /// Start an episode with host-selected routes.
    pub fn with_routes<I, S>(
        query: impl Into<String>,
        candidate_ids: I,
        routes: Vec<MemoryRoute>,
    ) -> Result<Self, RetrievalEpisodeError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let query = query.into();
        if query.trim().is_empty() {
            return Err(RetrievalEpisodeError::EmptyQuery);
        }
        let routes: BTreeSet<_> = routes.into_iter().collect();
        Ok(Self {
            episode_id: Uuid::new_v4().to_string(),
            query,
            routes: routes.into_iter().collect(),
            candidates: candidate_ids
                .into_iter()
                .map(Into::into)
                .map(|id: String| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect(),
            opened: BTreeMap::new(),
        })
    }

    pub fn episode_id(&self) -> &str {
        &self.episode_id
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    pub fn routes(&self) -> &[MemoryRoute] {
        &self.routes
    }

    pub fn candidate_ids(&self) -> Vec<String> {
        self.candidates.iter().cloned().collect()
    }

    pub fn opened_evidence(&self) -> Vec<OpenedEvidenceReceipt> {
        self.opened.values().cloned().collect()
    }

    /// Verify and record one piece of evidence as actually opened.
    pub fn open_evidence(
        &mut self,
        claim: &EvidenceClaim,
        document: &SourceDocument,
        current_source_bytes: &[u8],
        route: MemoryRoute,
        support_keys: Vec<String>,
    ) -> Result<EvidenceOpenResult, RetrievalEpisodeError> {
        let record_id = claim.record_id.trim();
        if !self.candidates.contains(record_id) {
            return Err(RetrievalEpisodeError::RecordNotCandidate(record_id.into()));
        }
        if !self.routes.contains(&route) {
            return Err(RetrievalEpisodeError::RouteNotEnabled(
                route.as_str().into(),
            ));
        }
        if self.opened.contains_key(record_id) {
            return Err(RetrievalEpisodeError::DuplicateOpenedRecord(
                record_id.into(),
            ));
        }
        if claim.claim_id.trim().is_empty() {
            return Err(RetrievalEpisodeError::EmptyClaimId);
        }

        let support_keys = normalize_support_keys(support_keys)?;
        let integrity = verify_lineage(document, current_source_bytes, &claim.lineage);
        let admission = admission_decision(claim, &integrity);
        let reason = match admission {
            AdmissionDecision::Cite => "citable",
            AdmissionDecision::ContextOnly => "context_only",
            AdmissionDecision::Block if !integrity.is_valid() => "lineage_invalid",
            AdmissionDecision::Block => "evidence_blocked",
        }
        .to_string();
        let receipt = OpenedEvidenceReceipt {
            record_id: record_id.to_string(),
            claim_id: claim.claim_id.clone(),
            route,
            admission,
            integrity_valid: integrity.is_valid(),
            document_id: claim.lineage.document_id.clone(),
            revision_id: claim.lineage.revision_id.clone(),
            span_hash: claim.lineage.span_hash.clone(),
            support_keys,
        };
        self.opened.insert(record_id.to_string(), receipt.clone());
        Ok(EvidenceOpenResult {
            citable: admission == AdmissionDecision::Cite,
            receipt,
            reason,
        })
    }

    /// Apply the citation lock to a proposed memory-backed answer.
    ///
    /// `answer_present=false` represents an explicit abstention. Hosts provide
    /// stable atomic claim keys; every key must be covered by at least one
    /// actually opened, citable evidence receipt.
    pub fn finalize(
        &self,
        answer_present: bool,
        citations: &[String],
        atomic_claim_keys: &[String],
    ) -> CitationLockReport {
        let citations = normalize_ids(citations);
        let claim_keys: BTreeSet<_> = atomic_claim_keys
            .iter()
            .map(|key| normalize_key(key))
            .filter(|key| !key.is_empty())
            .collect();
        let opened_record_ids: Vec<_> = self.opened.keys().cloned().collect();

        if !answer_present {
            let all_citations_opened = citations.iter().all(|id| self.opened.contains_key(id));
            let all_citations_citable = citations.iter().all(|id| {
                self.opened
                    .get(id)
                    .is_some_and(|receipt| receipt.admission == AdmissionDecision::Cite)
            });
            let cited: BTreeSet<_> = citations.iter().cloned().collect();
            let unused_opened_record_ids = self
                .opened
                .keys()
                .filter(|id| !cited.contains(*id))
                .cloned()
                .collect();
            let reasons = if citations.is_empty() {
                vec!["answer_abstained".into()]
            } else {
                vec!["abstention_must_not_cite".into()]
            };
            return CitationLockReport {
                episode_id: self.episode_id.clone(),
                decision: if citations.is_empty() {
                    CitationLockDecision::Abstain
                } else {
                    CitationLockDecision::Block
                },
                answer_permitted: false,
                reasons,
                citations,
                opened_record_ids,
                unsupported_claim_keys: Vec::new(),
                unused_opened_record_ids,
                all_citations_opened,
                all_citations_citable,
                all_claims_supported: true,
            };
        }

        let mut reasons = Vec::new();
        if citations.is_empty() {
            reasons.push("missing_citation".into());
        }
        if claim_keys.is_empty() {
            reasons.push("missing_atomic_claim_keys".into());
        }

        let mut all_citations_opened = true;
        let mut all_citations_citable = true;
        let mut supported = BTreeSet::new();
        for citation in &citations {
            match self.opened.get(citation) {
                None => {
                    all_citations_opened = false;
                    all_citations_citable = false;
                    reasons.push(format!("citation_not_opened:{citation}"));
                }
                Some(receipt) if receipt.admission != AdmissionDecision::Cite => {
                    all_citations_citable = false;
                    reasons.push(format!("citation_not_citable:{citation}"));
                }
                Some(receipt) => {
                    supported.extend(receipt.support_keys.iter().cloned());
                }
            }
        }

        let unsupported_claim_keys: Vec<_> = claim_keys.difference(&supported).cloned().collect();
        let all_claims_supported = unsupported_claim_keys.is_empty() && !claim_keys.is_empty();
        for key in &unsupported_claim_keys {
            reasons.push(format!("atomic_claim_unsupported:{key}"));
        }

        let cited: BTreeSet<_> = citations.iter().cloned().collect();
        let unused_opened_record_ids = self
            .opened
            .keys()
            .filter(|id| !cited.contains(*id))
            .cloned()
            .collect();
        let answer_permitted = !citations.is_empty()
            && !claim_keys.is_empty()
            && all_citations_opened
            && all_citations_citable
            && all_claims_supported;

        CitationLockReport {
            episode_id: self.episode_id.clone(),
            decision: if answer_permitted {
                CitationLockDecision::Allow
            } else {
                CitationLockDecision::Block
            },
            answer_permitted,
            reasons,
            citations,
            opened_record_ids,
            unsupported_claim_keys,
            unused_opened_record_ids,
            all_citations_opened,
            all_citations_citable,
            all_claims_supported,
        }
    }
}

fn normalize_support_keys(values: Vec<String>) -> Result<Vec<String>, RetrievalEpisodeError> {
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(RetrievalEpisodeError::EmptySupportKey);
    }
    Ok(values
        .iter()
        .map(|value| normalize_key(value))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect())
}

fn normalize_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn normalize_ids(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[cfg(feature = "python")]
#[pymethods]
impl RetrievalEpisode {
    #[getter]
    #[pyo3(name = "id")]
    fn py_id(&self) -> String {
        self.episode_id.clone()
    }

    #[getter]
    #[pyo3(name = "query")]
    fn py_query(&self) -> String {
        self.query.clone()
    }

    #[getter]
    #[pyo3(name = "routes")]
    fn py_routes(&self) -> Vec<String> {
        self.routes
            .iter()
            .map(|route| route.as_str().to_string())
            .collect()
    }

    #[getter]
    #[pyo3(name = "candidate_ids")]
    fn py_candidate_ids(&self) -> Vec<String> {
        self.candidate_ids()
    }

    #[pyo3(
        name = "open_verified_evidence",
        signature = (
            record_id, claim_id, claim_text, route, support_keys,
            document_id, revision_id, uri, registered_source_bytes,
            current_source_bytes, byte_start, byte_end,
            verification_status="candidate", answer_permission="context_only"
        )
    )]
    #[allow(clippy::too_many_arguments)]
    fn py_open_verified_evidence(
        &mut self,
        py: Python<'_>,
        record_id: &str,
        claim_id: &str,
        claim_text: &str,
        route: &str,
        support_keys: Vec<String>,
        document_id: &str,
        revision_id: &str,
        uri: &str,
        registered_source_bytes: Vec<u8>,
        current_source_bytes: Vec<u8>,
        byte_start: usize,
        byte_end: usize,
        verification_status: &str,
        answer_permission: &str,
    ) -> PyResult<PyObject> {
        use crate::evidence::{AnswerPermission, SourceSpan, VerificationStatus};

        let route = MemoryRoute::parse(route)
            .ok_or_else(|| pyo3::exceptions::PyValueError::new_err("invalid memory route"))?;
        let verification_status =
            VerificationStatus::parse(verification_status).ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err("invalid verification_status")
            })?;
        let answer_permission = AnswerPermission::parse(answer_permission)
            .ok_or_else(|| pyo3::exceptions::PyValueError::new_err("invalid answer_permission"))?;
        let document =
            SourceDocument::from_bytes(document_id, revision_id, uri, &registered_source_bytes);
        let span =
            SourceSpan::from_document(&document, &registered_source_bytes, byte_start, byte_end)
                .map_err(|error| pyo3::exceptions::PyValueError::new_err(error.to_string()))?;
        let claim = EvidenceClaim {
            claim_id: claim_id.to_string(),
            record_id: record_id.to_string(),
            claim_text: claim_text.to_string(),
            lineage: span,
            verification_status,
            answer_permission,
            confidence: 1.0,
            supporting_lineage_groups: Vec::new(),
            conflicting_claim_ids: Vec::new(),
            evidence_debt: Vec::new(),
        };
        let result = self
            .open_evidence(
                &claim,
                &document,
                &current_source_bytes,
                route,
                support_keys,
            )
            .map_err(|error| pyo3::exceptions::PyValueError::new_err(error.to_string()))?;
        evidence_open_result_to_py(py, &result)
    }

    #[pyo3(name = "finalize", signature = (answer_present, citations, atomic_claim_keys))]
    fn py_finalize(
        &self,
        py: Python<'_>,
        answer_present: bool,
        citations: Vec<String>,
        atomic_claim_keys: Vec<String>,
    ) -> PyResult<PyObject> {
        citation_lock_report_to_py(
            py,
            &self.finalize(answer_present, &citations, &atomic_claim_keys),
        )
    }
}

#[cfg(feature = "python")]
fn evidence_open_result_to_py(py: Python<'_>, result: &EvidenceOpenResult) -> PyResult<PyObject> {
    let dict = pyo3::types::PyDict::new_bound(py);
    dict.set_item("record_id", &result.receipt.record_id)?;
    dict.set_item("claim_id", &result.receipt.claim_id)?;
    dict.set_item("route", result.receipt.route.as_str())?;
    dict.set_item("admission", result.receipt.admission.as_str())?;
    dict.set_item("integrity_valid", result.receipt.integrity_valid)?;
    dict.set_item("document_id", &result.receipt.document_id)?;
    dict.set_item("revision_id", &result.receipt.revision_id)?;
    dict.set_item("span_hash", &result.receipt.span_hash)?;
    dict.set_item("support_keys", &result.receipt.support_keys)?;
    dict.set_item("citable", result.citable)?;
    dict.set_item("reason", &result.reason)?;
    Ok(dict.unbind().into_any())
}

#[cfg(feature = "python")]
pub(crate) fn citation_lock_report_to_py(
    py: Python<'_>,
    report: &CitationLockReport,
) -> PyResult<PyObject> {
    let dict = pyo3::types::PyDict::new_bound(py);
    dict.set_item("episode_id", &report.episode_id)?;
    dict.set_item("decision", report.decision.as_str())?;
    dict.set_item("answer_permitted", report.answer_permitted)?;
    dict.set_item("reasons", &report.reasons)?;
    dict.set_item("citations", &report.citations)?;
    dict.set_item("opened_record_ids", &report.opened_record_ids)?;
    dict.set_item("unsupported_claim_keys", &report.unsupported_claim_keys)?;
    dict.set_item("unused_opened_record_ids", &report.unused_opened_record_ids)?;
    dict.set_item("all_citations_opened", report.all_citations_opened)?;
    dict.set_item("all_citations_citable", report.all_citations_citable)?;
    dict.set_item("all_claims_supported", report.all_claims_supported)?;
    Ok(dict.unbind().into_any())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AnswerPermission, SourceSpan, VerificationStatus};

    fn evidence(
        record_id: &str,
        status: VerificationStatus,
        permission: AnswerPermission,
    ) -> (SourceDocument, Vec<u8>, EvidenceClaim) {
        let bytes = format!("Verified fact for {record_id}: value-42").into_bytes();
        let document = SourceDocument::from_bytes(
            format!("doc-{record_id}"),
            "rev-1",
            format!("memory://{record_id}"),
            &bytes,
        );
        let span = SourceSpan::from_document(&document, &bytes, 0, bytes.len()).unwrap();
        let claim = EvidenceClaim {
            claim_id: format!("claim-{record_id}"),
            record_id: record_id.into(),
            claim_text: "value-42".into(),
            lineage: span,
            verification_status: status,
            answer_permission: permission,
            confidence: 0.99,
            supporting_lineage_groups: Vec::new(),
            conflicting_claim_ids: Vec::new(),
            evidence_debt: Vec::new(),
        };
        (document, bytes, claim)
    }

    #[test]
    fn valid_opened_evidence_allows_supported_answer() {
        let mut episode = RetrievalEpisode::with_routes(
            "What is the value?",
            ["record-1"],
            vec![MemoryRoute::Documentary],
        )
        .unwrap();
        let (document, bytes, claim) = evidence(
            "record-1",
            VerificationStatus::Verified,
            AnswerPermission::Cite,
        );
        episode
            .open_evidence(
                &claim,
                &document,
                &bytes,
                MemoryRoute::Documentary,
                vec!["value".into()],
            )
            .unwrap();
        let report = episode.finalize(true, &["record-1".into()], &["value".into()]);
        assert_eq!(report.decision, CitationLockDecision::Allow);
        assert!(report.answer_permitted);
    }

    #[test]
    fn unopened_and_partially_supported_answers_are_blocked() {
        let episode = RetrievalEpisode::new("compound question", ["one", "two"]).unwrap();
        let unopened = episode.finalize(true, &["one".into()], &["first".into()]);
        assert!(!unopened.all_citations_opened);
        assert_eq!(unopened.decision, CitationLockDecision::Block);

        let mut episode = episode;
        let (document, bytes, claim) =
            evidence("one", VerificationStatus::Verified, AnswerPermission::Cite);
        episode
            .open_evidence(
                &claim,
                &document,
                &bytes,
                MemoryRoute::Documentary,
                vec!["first".into()],
            )
            .unwrap();
        let partial = episode.finalize(true, &["one".into()], &["first".into(), "second".into()]);
        assert_eq!(partial.unsupported_claim_keys, vec!["second"]);
        assert!(!partial.answer_permitted);
    }

    #[test]
    fn tampering_and_non_citable_status_are_recorded_but_cannot_authorize() {
        let mut episode = RetrievalEpisode::new("What is the value?", ["tampered"]).unwrap();
        let (document, mut bytes, claim) = evidence(
            "tampered",
            VerificationStatus::Verified,
            AnswerPermission::Cite,
        );
        bytes.push(b'!');
        let opened = episode
            .open_evidence(
                &claim,
                &document,
                &bytes,
                MemoryRoute::Timeline,
                vec!["value".into()],
            )
            .unwrap();
        assert_eq!(opened.reason, "lineage_invalid");
        let report = episode.finalize(true, &["tampered".into()], &["value".into()]);
        assert!(!report.all_citations_citable);

        let mut episode = RetrievalEpisode::new("What is the value?", ["candidate"]).unwrap();
        let (document, bytes, claim) = evidence(
            "candidate",
            VerificationStatus::Candidate,
            AnswerPermission::ContextOnly,
        );
        episode
            .open_evidence(
                &claim,
                &document,
                &bytes,
                MemoryRoute::Timeline,
                vec!["value".into()],
            )
            .unwrap();
        assert!(
            !episode
                .finalize(true, &["candidate".into()], &["value".into()])
                .answer_permitted
        );
    }

    #[test]
    fn explicit_abstention_is_safe_and_citation_free() {
        let episode = RetrievalEpisode::new("unknown question", Vec::<String>::new()).unwrap();
        let report = episode.finalize(false, &[], &[]);
        assert_eq!(report.decision, CitationLockDecision::Abstain);
        assert!(!report.answer_permitted);
    }

    #[test]
    fn intent_is_advisory_and_defaults_to_all_routes() {
        let self_contained = suggest_memory_intent("Calculate 17 + 25");
        assert!(!self_contained.needs_memory);

        let referenced = suggest_memory_intent("Rewrite my previous decision");
        assert!(referenced.needs_memory);

        let unknown = suggest_memory_intent("What did we discuss about zephyrs?");
        assert_eq!(unknown.suggested_routes, MemoryRoute::all());

        let mixed = suggest_memory_intent("Which project changed its launch date?");
        assert_eq!(
            mixed.suggested_routes,
            vec![MemoryRoute::Timeline, MemoryRoute::Graph]
        );
    }
}
