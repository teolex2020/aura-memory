//! Research orchestrator — multi-step research as a first-class SDK feature.
//!
//! Rewritten from brain_tools.py research logic.

use parking_lot::RwLock;
use std::collections::HashMap;
use uuid::Uuid;

use crate::credibility::SourceCredibility;
use crate::evidence::{
    source_admission_decision, verify_lineage, AdmissionDecision, AnswerPermission,
    IntegrityReport, SourceDocument, SourceSpan, VerificationStatus,
};

/// Research project status.
#[derive(Debug, Clone, PartialEq)]
pub enum ResearchStatus {
    Active,
    Completed,
    Cancelled,
}

/// A research finding — one data point in a research project.
#[derive(Debug, Clone)]
pub struct ResearchFinding {
    pub query: String,
    pub result: String,
    pub url: Option<String>,
    pub credibility: f32,
    pub timestamp: String,
    /// Present only for evidence-aware ingestion. Legacy findings remain valid.
    pub source_document: Option<SourceDocument>,
    pub source_span: Option<SourceSpan>,
    pub integrity: Option<IntegrityReport>,
    pub verification_status: Option<VerificationStatus>,
    pub answer_permission: Option<AnswerPermission>,
    pub admission: Option<AdmissionDecision>,
}

/// A research project — tracks queries, findings, and synthesis.
#[derive(Debug, Clone)]
pub struct ResearchProject {
    pub id: String,
    pub topic: String,
    pub depth: String,
    pub status: ResearchStatus,
    pub queries: Vec<String>,
    pub findings: Vec<ResearchFinding>,
    pub synthesis: Option<String>,
    pub created_at: String,
}

/// Research orchestrator managing multiple research projects.
pub struct ResearchEngine {
    /// Active projects: project_id → project.
    projects: RwLock<HashMap<String, ResearchProject>>,
    /// Source credibility scorer.
    credibility: RwLock<SourceCredibility>,
}

impl ResearchEngine {
    pub fn new() -> Self {
        Self {
            projects: RwLock::new(HashMap::new()),
            credibility: RwLock::new(SourceCredibility::new()),
        }
    }

    /// Start a new research project.
    ///
    /// Returns the project with suggested queries (placeholder — real queries
    /// come from LLM via `llm_fn` callback if available).
    pub fn start_research(&self, topic: &str, depth: Option<&str>) -> ResearchProject {
        let depth = depth.unwrap_or("standard");
        let num_queries = match depth {
            "quick" => 2,
            "deep" => 7,
            _ => 4, // standard
        };

        // Generate placeholder queries — in real usage, LLM generates these
        let queries: Vec<String> = (0..num_queries)
            .map(|i| format!("{} query {}", topic, i + 1))
            .collect();

        let project = ResearchProject {
            id: Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            depth: depth.to_string(),
            status: ResearchStatus::Active,
            queries,
            findings: Vec::new(),
            synthesis: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        let id = project.id.clone();
        self.projects.write().insert(id, project.clone());
        project
    }

    /// Add a research finding to a project.
    pub fn add_finding(
        &self,
        project_id: &str,
        query: &str,
        result: &str,
        url: Option<&str>,
    ) -> Result<(), String> {
        let credibility_score = url
            .map(|u| self.credibility.read().get_score(u))
            .unwrap_or(0.5);

        let finding = ResearchFinding {
            query: query.to_string(),
            result: result.to_string(),
            url: url.map(|s| s.to_string()),
            credibility: credibility_score,
            timestamp: chrono::Utc::now().to_rfc3339(),
            source_document: None,
            source_span: None,
            integrity: None,
            verification_status: None,
            answer_permission: None,
            admission: None,
        };

        let mut projects = self.projects.write();
        let project = projects
            .get_mut(project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;

        if project.status != ResearchStatus::Active {
            return Err("Project is not active".to_string());
        }

        project.findings.push(finding);
        Ok(())
    }

    /// Add a finding bound to an exact byte span of an immutable source revision.
    ///
    /// The complete source bytes are hashed before the span is accepted. The
    /// returned admission decision is safe to use for research composition, but
    /// a final citable Aura claim still needs a cognitive record binding.
    #[allow(clippy::too_many_arguments)]
    pub fn add_evidence_finding(
        &self,
        project_id: &str,
        query: &str,
        result: &str,
        document_id: &str,
        revision_id: &str,
        uri: &str,
        source_bytes: &[u8],
        byte_start: usize,
        byte_end: usize,
        verification_status: VerificationStatus,
        answer_permission: AnswerPermission,
        page_start: Option<u32>,
        page_end: Option<u32>,
        cell_range: Option<&str>,
    ) -> Result<ResearchFinding, String> {
        let document = SourceDocument::from_bytes(document_id, revision_id, uri, source_bytes);
        let mut span = SourceSpan::from_document(&document, source_bytes, byte_start, byte_end)
            .map_err(|error| error.to_string())?;
        match (page_start, page_end) {
            (Some(start), Some(end)) if start <= end => {
                span = span.with_pages(start, end);
            }
            (None, None) => {}
            _ => return Err("page_start and page_end must be present together and ordered".into()),
        }
        if let Some(range) = cell_range.filter(|value| !value.trim().is_empty()) {
            span = span.with_cell_range(range);
        }
        let integrity = verify_lineage(&document, source_bytes, &span);
        let admission =
            source_admission_decision(verification_status, answer_permission, &integrity, &span);
        let finding = ResearchFinding {
            query: query.to_string(),
            result: result.to_string(),
            url: Some(uri.to_string()),
            credibility: self.credibility.read().get_score(uri),
            timestamp: chrono::Utc::now().to_rfc3339(),
            source_document: Some(document),
            source_span: Some(span),
            integrity: Some(integrity),
            verification_status: Some(verification_status),
            answer_permission: Some(answer_permission),
            admission: Some(admission),
        };

        let mut projects = self.projects.write();
        let project = projects
            .get_mut(project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;
        if project.status != ResearchStatus::Active {
            return Err("Project is not active".to_string());
        }
        project.findings.push(finding.clone());
        Ok(finding)
    }

    /// Complete a research project. Returns the project for storage.
    ///
    /// If `synthesis` is provided (from LLM), it's attached to the project.
    /// Without synthesis, the project is completed with raw findings only.
    pub fn complete_research(
        &self,
        project_id: &str,
        synthesis: Option<String>,
    ) -> Result<ResearchProject, String> {
        let mut projects = self.projects.write();
        let project = projects
            .get_mut(project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;

        project.status = ResearchStatus::Completed;
        project.synthesis = synthesis;

        Ok(project.clone())
    }

    /// Cancel a research project.
    pub fn cancel_research(&self, project_id: &str) -> Result<(), String> {
        let mut projects = self.projects.write();
        let project = projects
            .get_mut(project_id)
            .ok_or_else(|| format!("Project {} not found", project_id))?;
        project.status = ResearchStatus::Cancelled;
        Ok(())
    }

    /// Get all active research projects.
    pub fn active_projects(&self) -> Vec<ResearchProject> {
        self.projects
            .read()
            .values()
            .filter(|p| p.status == ResearchStatus::Active)
            .cloned()
            .collect()
    }

    /// Get a specific project by ID.
    pub fn get_project(&self, project_id: &str) -> Option<ResearchProject> {
        self.projects.read().get(project_id).cloned()
    }

    /// Set a credibility override for a domain.
    pub fn set_credibility_override(&self, domain: &str, score: f32) {
        self.credibility.write().set_override(domain, score);
    }

    /// Get credibility score for a URL.
    pub fn get_credibility(&self, url: &str) -> f32 {
        self.credibility.read().get_score(url)
    }
}

impl Default for ResearchEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_research_lifecycle() {
        let engine = ResearchEngine::new();

        // Start
        let project = engine.start_research("GRPO for memory ranking", Some("standard"));
        assert_eq!(project.status, ResearchStatus::Active);
        assert_eq!(project.queries.len(), 4);

        // Add findings
        engine
            .add_finding(
                &project.id,
                "GRPO paper",
                "Published by DeepSeek...",
                Some("https://arxiv.org/paper/123"),
            )
            .unwrap();

        let p = engine.get_project(&project.id).unwrap();
        assert_eq!(p.findings.len(), 1);
        assert!(p.findings[0].credibility > 0.8); // arxiv = 0.90

        // Complete
        let completed = engine
            .complete_research(
                &project.id,
                Some("GRPO is a group-relative policy optimization...".into()),
            )
            .unwrap();
        assert_eq!(completed.status, ResearchStatus::Completed);
        assert!(completed.synthesis.is_some());
    }

    #[test]
    fn test_credibility_in_findings() {
        let engine = ResearchEngine::new();
        let project = engine.start_research("test", None);

        engine
            .add_finding(
                &project.id,
                "q1",
                "result",
                Some("https://reddit.com/r/test"),
            )
            .unwrap();
        engine
            .add_finding(&project.id, "q2", "result", Some("https://nature.com/123"))
            .unwrap();

        let p = engine.get_project(&project.id).unwrap();
        assert!(p.findings[1].credibility > p.findings[0].credibility);
    }

    #[test]
    fn evidence_finding_has_verified_lineage_and_admission() {
        let engine = ResearchEngine::new();
        let project = engine.start_research("verified figures", None);
        let source = b"Table 1\nEnrollment: 420\n";
        let start = b"Table 1\n".len();
        let end = start + b"Enrollment: 420".len();
        let finding = engine
            .add_evidence_finding(
                &project.id,
                "enrollment",
                "Enrollment is 420",
                "annual-report",
                "2026",
                "file:///annual-report.txt",
                source,
                start,
                end,
                VerificationStatus::Verified,
                AnswerPermission::Cite,
                Some(1),
                Some(1),
                Some("B2"),
            )
            .unwrap();
        assert_eq!(finding.admission, Some(AdmissionDecision::Cite));
        assert!(finding.integrity.unwrap().is_valid());
        assert_eq!(
            finding.source_span.unwrap().cell_range.as_deref(),
            Some("B2")
        );
    }
}
