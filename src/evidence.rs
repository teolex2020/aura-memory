//! Immutable source lineage and evidence-admission primitives.
//!
//! Aura's provenance chain explains how a cognitive record was produced and
//! used inside the runtime. This module answers a different question: does a
//! claim still point to the exact bytes of the exact source revision from
//! which it was extracted?

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Stable SHA-256 digest used by the source-lineage contract.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Metadata for one immutable revision of an external source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceDocument {
    /// Stable logical document identifier, shared by all revisions.
    pub document_id: String,
    /// Caller-controlled revision identifier (ETag, generation, commit, etc.).
    pub revision_id: String,
    /// Original URI or storage locator.
    pub uri: String,
    /// SHA-256 of the complete, unmodified source bytes.
    pub content_hash: String,
    /// Exact byte length used to detect truncation before span verification.
    pub byte_length: u64,
    /// Optional media type such as `text/markdown` or `application/pdf`.
    pub media_type: Option<String>,
}

impl SourceDocument {
    pub fn from_bytes(
        document_id: impl Into<String>,
        revision_id: impl Into<String>,
        uri: impl Into<String>,
        bytes: &[u8],
    ) -> Self {
        Self {
            document_id: document_id.into(),
            revision_id: revision_id.into(),
            uri: uri.into(),
            content_hash: sha256_hex(bytes),
            byte_length: bytes.len() as u64,
            media_type: None,
        }
    }

    pub fn with_media_type(mut self, media_type: impl Into<String>) -> Self {
        self.media_type = Some(media_type.into());
        self
    }

    /// Verify that bytes are the complete content of this source revision.
    pub fn verify_content(&self, bytes: &[u8]) -> bool {
        self.byte_length == bytes.len() as u64 && self.content_hash == sha256_hex(bytes)
    }
}

/// Exact source fragment supporting a claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceSpan {
    pub document_id: String,
    pub revision_id: String,
    /// Half-open byte range `[byte_start, byte_end)` over original source bytes.
    pub byte_start: u64,
    pub byte_end: u64,
    pub span_hash: String,
    pub page_start: Option<u32>,
    pub page_end: Option<u32>,
    /// Optional table/cell locator for structured evidence.
    pub cell_range: Option<String>,
}

impl SourceSpan {
    pub fn from_document(
        document: &SourceDocument,
        source_bytes: &[u8],
        byte_start: usize,
        byte_end: usize,
    ) -> Result<Self, EvidenceError> {
        if !document.verify_content(source_bytes) {
            return Err(EvidenceError::DocumentContentMismatch);
        }
        let span = source_bytes
            .get(byte_start..byte_end)
            .ok_or(EvidenceError::SpanOutOfBounds)?;
        if span.is_empty() {
            return Err(EvidenceError::EmptySpan);
        }
        Ok(Self {
            document_id: document.document_id.clone(),
            revision_id: document.revision_id.clone(),
            byte_start: byte_start as u64,
            byte_end: byte_end as u64,
            span_hash: sha256_hex(span),
            page_start: None,
            page_end: None,
            cell_range: None,
        })
    }

    pub fn with_pages(mut self, page_start: u32, page_end: u32) -> Self {
        self.page_start = Some(page_start);
        self.page_end = Some(page_end);
        self
    }

    pub fn with_cell_range(mut self, cell_range: impl Into<String>) -> Self {
        self.cell_range = Some(cell_range.into());
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Candidate,
    Corroborated,
    Verified,
    Contested,
    Superseded,
    Refuted,
}

impl VerificationStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "candidate" => Some(Self::Candidate),
            "corroborated" => Some(Self::Corroborated),
            "verified" => Some(Self::Verified),
            "contested" => Some(Self::Contested),
            "superseded" => Some(Self::Superseded),
            "refuted" => Some(Self::Refuted),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerPermission {
    Cite,
    ContextOnly,
    Blocked,
}

impl AnswerPermission {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "cite" => Some(Self::Cite),
            "context_only" | "context-only" => Some(Self::ContextOnly),
            "blocked" | "block" => Some(Self::Blocked),
            _ => None,
        }
    }
}

/// Binds a cognitive record to external evidence without changing `Record`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvidenceClaim {
    pub claim_id: String,
    pub record_id: String,
    pub claim_text: String,
    pub lineage: SourceSpan,
    pub verification_status: VerificationStatus,
    pub answer_permission: AnswerPermission,
    /// Confidence is descriptive only; it never overrides lineage or status.
    pub confidence: f32,
    #[serde(default)]
    pub supporting_lineage_groups: Vec<String>,
    #[serde(default)]
    pub conflicting_claim_ids: Vec<String>,
    #[serde(default)]
    pub evidence_debt: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrityIssueKind {
    DocumentIdMismatch,
    RevisionMismatch,
    DocumentLengthMismatch,
    DocumentHashMismatch,
    SpanOutOfBounds,
    EmptySpan,
    SpanHashMismatch,
    InvalidPageRange,
    MissingRecordBinding,
    GeneratedClaimMarkedVerified,
    CitationNotPermitted,
    IntegrityReportLineageMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegrityIssue {
    pub kind: IntegrityIssueKind,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntegrityReport {
    valid: bool,
    issues: Vec<IntegrityIssue>,
    verified_document_id: String,
    verified_revision_id: String,
    verified_span_hash: String,
    verified_byte_start: u64,
    verified_byte_end: u64,
}

impl IntegrityReport {
    fn for_span(span: &SourceSpan, issues: Vec<IntegrityIssue>) -> Self {
        Self {
            valid: issues.is_empty(),
            issues,
            verified_document_id: span.document_id.clone(),
            verified_revision_id: span.revision_id.clone(),
            verified_span_hash: span.span_hash.clone(),
            verified_byte_start: span.byte_start,
            verified_byte_end: span.byte_end,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.valid
    }

    pub fn issues(&self) -> &[IntegrityIssue] {
        &self.issues
    }

    fn matches_lineage(&self, lineage: &SourceSpan) -> bool {
        self.verified_document_id == lineage.document_id
            && self.verified_revision_id == lineage.revision_id
            && self.verified_span_hash == lineage.span_hash
            && self.verified_byte_start == lineage.byte_start
            && self.verified_byte_end == lineage.byte_end
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EvidenceError {
    #[error("source bytes do not match the registered document revision")]
    DocumentContentMismatch,
    #[error("source span is outside document bounds")]
    SpanOutOfBounds,
    #[error("source span must not be empty")]
    EmptySpan,
}

/// Verify external lineage. No trust score can turn a failed report into valid evidence.
pub fn verify_lineage(
    document: &SourceDocument,
    source_bytes: &[u8],
    span: &SourceSpan,
) -> IntegrityReport {
    let mut issues = Vec::new();
    if span.document_id != document.document_id {
        issues.push(issue(
            IntegrityIssueKind::DocumentIdMismatch,
            "span points to a different logical document",
        ));
    }
    if span.revision_id != document.revision_id {
        issues.push(issue(
            IntegrityIssueKind::RevisionMismatch,
            "span points to a different source revision",
        ));
    }
    if document.byte_length != source_bytes.len() as u64 {
        issues.push(issue(
            IntegrityIssueKind::DocumentLengthMismatch,
            "source byte length changed",
        ));
    }
    if document.content_hash != sha256_hex(source_bytes) {
        issues.push(issue(
            IntegrityIssueKind::DocumentHashMismatch,
            "complete source hash changed",
        ));
    }
    if span.byte_start >= span.byte_end {
        issues.push(issue(
            IntegrityIssueKind::EmptySpan,
            "span range is empty or reversed",
        ));
    }
    let selected = usize::try_from(span.byte_start)
        .ok()
        .zip(usize::try_from(span.byte_end).ok())
        .and_then(|(start, end)| source_bytes.get(start..end));
    match selected {
        Some(bytes) if !bytes.is_empty() => {
            if span.span_hash != sha256_hex(bytes) {
                issues.push(issue(
                    IntegrityIssueKind::SpanHashMismatch,
                    "source fragment no longer matches its recorded hash",
                ));
            }
        }
        _ => issues.push(issue(
            IntegrityIssueKind::SpanOutOfBounds,
            "span range is outside the supplied source bytes",
        )),
    }
    if matches!((span.page_start, span.page_end), (Some(start), Some(end)) if start > end) {
        issues.push(issue(
            IntegrityIssueKind::InvalidPageRange,
            "page_start is greater than page_end",
        ));
    }
    IntegrityReport::for_span(span, issues)
}

/// Result of applying lineage, truth-state, and answer-permission gates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionDecision {
    Cite,
    ContextOnly,
    Block,
}

impl AdmissionDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cite => "cite",
            Self::ContextOnly => "context_only",
            Self::Block => "block",
        }
    }
}

/// Admission before a cognitive record exists. Used by ingestion/research
/// pipelines; the full `admission_decision` additionally requires a record
/// binding before a claim can be cited from Aura memory.
pub fn source_admission_decision(
    verification_status: VerificationStatus,
    answer_permission: AnswerPermission,
    integrity: &IntegrityReport,
    lineage: &SourceSpan,
) -> AdmissionDecision {
    if !integrity.is_valid()
        || !integrity.matches_lineage(lineage)
        || matches!(
            verification_status,
            VerificationStatus::Contested
                | VerificationStatus::Superseded
                | VerificationStatus::Refuted
        )
        || answer_permission == AnswerPermission::Blocked
    {
        return AdmissionDecision::Block;
    }
    if answer_permission == AnswerPermission::Cite
        && matches!(
            verification_status,
            VerificationStatus::Corroborated | VerificationStatus::Verified
        )
    {
        AdmissionDecision::Cite
    } else {
        AdmissionDecision::ContextOnly
    }
}

pub fn admission_decision(claim: &EvidenceClaim, integrity: &IntegrityReport) -> AdmissionDecision {
    if claim.record_id.trim().is_empty() || !integrity.matches_lineage(&claim.lineage) {
        return AdmissionDecision::Block;
    }
    source_admission_decision(
        claim.verification_status,
        claim.answer_permission,
        integrity,
        &claim.lineage,
    )
}

/// Lint claim-level contract errors in addition to byte-lineage integrity.
pub fn lint_claim(
    claim: &EvidenceClaim,
    integrity: &IntegrityReport,
    cognitive_source_type: Option<&str>,
) -> Vec<IntegrityIssue> {
    let mut issues = integrity.issues().to_vec();
    if !integrity.matches_lineage(&claim.lineage) {
        issues.push(issue(
            IntegrityIssueKind::IntegrityReportLineageMismatch,
            "integrity report was produced for a different source span",
        ));
    }
    if claim.record_id.trim().is_empty() {
        issues.push(issue(
            IntegrityIssueKind::MissingRecordBinding,
            "claim is not bound to an Aura record",
        ));
    }
    if cognitive_source_type == Some("generated")
        && claim.verification_status == VerificationStatus::Verified
    {
        issues.push(issue(
            IntegrityIssueKind::GeneratedClaimMarkedVerified,
            "generated content cannot become verified without independent evidence",
        ));
    }
    if claim.answer_permission == AnswerPermission::Cite
        && admission_decision(claim, integrity) != AdmissionDecision::Cite
    {
        issues.push(issue(
            IntegrityIssueKind::CitationNotPermitted,
            "claim requests citation but does not pass admission",
        ));
    }
    issues
}

fn issue(kind: IntegrityIssueKind, detail: &str) -> IntegrityIssue {
    IntegrityIssue {
        kind,
        detail: detail.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (SourceDocument, Vec<u8>, SourceSpan) {
        let bytes = b"Header\nVerified value: 42\nFooter".to_vec();
        let document =
            SourceDocument::from_bytes("report", "2026-07", "file:///report.txt", &bytes);
        let start = b"Header\n".len();
        let end = start + b"Verified value: 42".len();
        let span = SourceSpan::from_document(&document, &bytes, start, end).unwrap();
        (document, bytes, span)
    }

    fn claim(span: SourceSpan) -> EvidenceClaim {
        EvidenceClaim {
            claim_id: "claim-1".into(),
            record_id: "record-1".into(),
            claim_text: "The verified value is 42".into(),
            lineage: span,
            verification_status: VerificationStatus::Verified,
            answer_permission: AnswerPermission::Cite,
            confidence: 0.99,
            supporting_lineage_groups: vec![],
            conflicting_claim_ids: vec![],
            evidence_debt: vec![],
        }
    }

    #[test]
    fn exact_revision_and_span_are_admitted_for_citation() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        assert!(report.is_valid());
        assert_eq!(
            admission_decision(&claim(span), &report),
            AdmissionDecision::Cite
        );
    }

    #[test]
    fn changed_source_is_blocked_even_with_high_confidence() {
        let (document, mut bytes, span) = fixture();
        let position = bytes.iter().position(|byte| *byte == b'4').unwrap();
        bytes[position] = b'9';
        let report = verify_lineage(&document, &bytes, &span);
        assert!(!report.is_valid());
        assert_eq!(
            admission_decision(&claim(span), &report),
            AdmissionDecision::Block
        );
        assert!(report
            .issues()
            .iter()
            .any(|item| item.kind == IntegrityIssueKind::DocumentHashMismatch));
    }

    #[test]
    fn superseded_claim_is_blocked_with_valid_bytes() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        let mut candidate = claim(span);
        candidate.verification_status = VerificationStatus::Superseded;
        assert_eq!(
            admission_decision(&candidate, &report),
            AdmissionDecision::Block
        );
    }

    #[test]
    fn candidate_is_context_only_not_citable() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        let mut candidate = claim(span);
        candidate.verification_status = VerificationStatus::Candidate;
        assert_eq!(
            admission_decision(&candidate, &report),
            AdmissionDecision::ContextOnly
        );
        assert!(lint_claim(&candidate, &report, Some("retrieved"))
            .iter()
            .any(|item| item.kind == IntegrityIssueKind::CitationNotPermitted));
    }

    #[test]
    fn source_admission_can_precede_record_binding() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        assert_eq!(
            source_admission_decision(
                VerificationStatus::Verified,
                AnswerPermission::Cite,
                &report,
                &span
            ),
            AdmissionDecision::Cite
        );
    }

    #[test]
    fn generated_record_cannot_silently_become_verified() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        assert!(lint_claim(&claim(span), &report, Some("generated"))
            .iter()
            .any(|item| item.kind == IntegrityIssueKind::GeneratedClaimMarkedVerified));
    }

    #[test]
    fn integrity_report_cannot_authorize_a_different_claim_lineage() {
        let (document, bytes, span) = fixture();
        let report = verify_lineage(&document, &bytes, &span);
        let mut different_span = span.clone();
        different_span.byte_start += 1;
        let mismatched_claim = claim(different_span);

        assert_eq!(
            admission_decision(&mismatched_claim, &report),
            AdmissionDecision::Block
        );
        assert!(lint_claim(&mismatched_claim, &report, Some("retrieved"))
            .iter()
            .any(|item| item.kind == IntegrityIssueKind::IntegrityReportLineageMismatch));
    }
}
