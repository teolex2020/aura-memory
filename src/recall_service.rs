//! RecallService — internal orchestration layer for recall execution.
//!
//! Keeps recall pipeline orchestration separate from the public `Aura` facade
//! without changing the retrieval primitives in `recall.rs`.

use std::collections::{HashMap, HashSet};

use anyhow::Result;

use crate::audit::AuditLog;
use crate::belief::BeliefEngine;
use crate::cache::{RecallCache, StructuredRecallCache};
use crate::causal::{CausalEngine, CausalRerankMode};
use crate::concept::{ConceptEngine, ConceptSurfaceMode};
use crate::graph::SessionTracker;
use crate::index::InvertedIndex;
use crate::lexical::LexicalIndex;
use crate::ngram::NGramIndex;
use crate::policy::{PolicyEngine, PolicyRerankMode};
use crate::recall;
use crate::record::Record;
use crate::sdr::SDRInterpreter;
use crate::storage::AuraStorage;
use crate::trust::TrustConfig;

pub(crate) struct RecallPipelineView<'a> {
    pub(crate) sdr: &'a SDRInterpreter,
    pub(crate) index: &'a InvertedIndex,
    pub(crate) storage: &'a AuraStorage,
    pub(crate) ngram: &'a NGramIndex,
    pub(crate) lexical: &'a LexicalIndex,
    pub(crate) tag_index: &'a HashMap<String, HashSet<String>>,
    pub(crate) aura_index: &'a HashMap<String, String>,
    pub(crate) records: &'a HashMap<String, Record>,
    pub(crate) embedding_ranked: Option<Vec<(String, f32)>>,
    pub(crate) trust_config: Option<&'a TrustConfig>,
}

pub(crate) struct RecallRerankView<'a> {
    pub(crate) belief_engine: &'a BeliefEngine,
    pub(crate) concept_engine: &'a ConceptEngine,
    pub(crate) causal_engine: &'a CausalEngine,
    pub(crate) policy_engine: &'a PolicyEngine,
    pub(crate) belief_mode: recall::BeliefRerankMode,
    pub(crate) concept_mode: ConceptSurfaceMode,
    pub(crate) causal_mode: CausalRerankMode,
    pub(crate) policy_mode: PolicyRerankMode,
}

pub(crate) struct RecallService;

#[cfg(test)]
mod cache_regressions {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn expansion_changes_recompute_and_sessions_always_execute() -> Result<()> {
        let text = RecallCache::default();
        let structured = StructuredRecallCache::default();
        let text_calls = Cell::new(0);
        let structured_calls = Cell::new(0);
        // Identical stateless requests hit, expansion changes miss, and every
        // session request runs the core that performs activation/coactivation.
        for (expand, session, expected) in [
            (false, None, 1),
            (false, None, 1),
            (true, None, 2),
            (true, Some("session-a"), 3),
            (true, Some("session-a"), 4),
        ] {
            RecallService::recall_formatted(
                &text,
                "query",
                2048,
                0.0,
                expand,
                session,
                None,
                || {
                    text_calls.set(text_calls.get() + 1);
                    Ok(vec![])
                },
                |_| "context".into(),
            )?;
            RecallService::recall_structured_cached(
                &structured,
                "query",
                5,
                0.0,
                expand,
                session,
                None,
                || {
                    structured_calls.set(structured_calls.get() + 1);
                    Ok(vec![])
                },
            )?;
            assert_eq!(text_calls.get(), expected);
            assert_eq!(structured_calls.get(), expected);
        }
        Ok(())
    }
}

impl RecallService {
    pub(crate) fn text_cache_key(query: &str, namespaces: Option<&[&str]>) -> String {
        let default_ns = [crate::record::DEFAULT_NAMESPACE];
        let ns_list = namespaces.unwrap_or(&default_ns);
        let mut sorted_ns: Vec<&str> = ns_list.to_vec();
        sorted_ns.sort_unstable();
        sorted_ns.dedup();
        // Hash a structured key before handing it to the legacy text cache,
        // whose normalization must never lowercase namespace identifiers.
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(
            serde_json::to_vec(&(query.trim().to_lowercase(), sorted_ns)).unwrap(),
        ))
    }

    pub(crate) fn raw(
        view: RecallPipelineView<'_>,
        query: &str,
        top_k: usize,
        min_strength: f32,
        expand_connections: bool,
        namespaces: Option<&[&str]>,
    ) -> Vec<(f32, Record)> {
        recall::recall_pipeline(
            query,
            top_k,
            min_strength,
            expand_connections,
            view.sdr,
            view.index,
            view.storage,
            view.ngram,
            view.lexical,
            view.tag_index,
            view.aura_index,
            view.records,
            view.embedding_ranked,
            view.trust_config,
            namespaces,
        )
    }

    pub(crate) fn raw_with_trace(
        view: RecallPipelineView<'_>,
        query: &str,
        top_k: usize,
        min_strength: f32,
        expand_connections: bool,
        namespaces: Option<&[&str]>,
    ) -> recall::RecallTraceResult {
        recall::recall_pipeline_with_trace(
            query,
            top_k,
            min_strength,
            expand_connections,
            view.sdr,
            view.index,
            view.storage,
            view.ngram,
            view.lexical,
            view.tag_index,
            view.aura_index,
            view.records,
            view.embedding_ranked,
            view.trust_config,
            namespaces,
        )
    }

    pub(crate) fn apply_bounded_reranking(
        scored: &mut Vec<(f32, Record)>,
        top_k: usize,
        view: RecallRerankView<'_>,
    ) {
        if view.belief_mode == recall::BeliefRerankMode::Limited {
            let _report = recall::apply_belief_rerank(scored, view.belief_engine, top_k);
        }

        if view.concept_mode == ConceptSurfaceMode::Limited {
            let _report = recall::apply_concept_rerank(scored, view.concept_engine, top_k);
        }

        if view.causal_mode == CausalRerankMode::Limited {
            let _report = recall::apply_causal_rerank(scored, view.causal_engine, top_k);
        }

        if view.policy_mode == PolicyRerankMode::Limited {
            let _report = recall::apply_policy_rerank(scored, view.policy_engine, top_k);
        }
    }

    pub(crate) fn finalize(
        scored: &[(f32, Record)],
        query: &str,
        session_id: Option<&str>,
        records: &mut HashMap<String, Record>,
        tracker: &mut SessionTracker,
        audit_log: Option<&AuditLog>,
    ) {
        recall::activate_and_strengthen(scored, records, tracker, session_id);
        if let Some(log) = audit_log {
            let _ = log.log_retrieve(query, scored.len());
        }
    }

    pub(crate) fn recall_formatted<F, G>(
        cache: &RecallCache,
        query: &str,
        token_budget: usize,
        min_strength: f32,
        expand_connections: bool,
        session_id: Option<&str>,
        namespaces: Option<&[&str]>,
        run_core: F,
        format_preamble: G,
    ) -> Result<String>
    where
        F: FnOnce() -> Result<Vec<(f32, Record)>>,
        G: FnOnce(&[(f32, Record)]) -> String,
    {
        let cache_key = format!(
            "{}:{token_budget}:{}:{expand_connections}",
            Self::text_cache_key(query, namespaces),
            min_strength.to_bits()
        );
        if session_id.is_none() {
            if let Some(cached) = cache.get(&cache_key) {
                return Ok(cached);
            }
        }

        let scored = run_core()?;
        let preamble = format_preamble(&scored);
        if session_id.is_none() {
            cache.put(&cache_key, preamble.clone());
        }
        Ok(preamble)
    }

    pub(crate) fn recall_structured_cached<F>(
        cache: &StructuredRecallCache,
        query: &str,
        top_k: usize,
        min_strength: f32,
        expand_connections: bool,
        session_id: Option<&str>,
        namespaces: Option<&[&str]>,
        run_core: F,
    ) -> Result<Vec<(f32, Record)>>
    where
        F: FnOnce() -> Result<Vec<(f32, Record)>>,
    {
        let cache_query = format!(
            "{}:{expand_connections}",
            Self::text_cache_key(query, namespaces)
        );
        if session_id.is_none() {
            if let Some(cached) = cache.get(&cache_query, top_k, min_strength, namespaces) {
                return Ok(cached);
            }
        }

        let scored = run_core()?;
        if session_id.is_none() {
            cache.put(
                &cache_query,
                top_k,
                min_strength,
                namespaces,
                scored.clone(),
            );
        }
        Ok(scored)
    }

    pub(crate) fn shadow_report(
        scored: &[(f32, Record)],
        belief_engine: &BeliefEngine,
        top_k: usize,
    ) -> recall::ShadowRecallReport {
        recall::compute_shadow_belief_scores(scored, belief_engine, top_k)
    }

    pub(crate) fn rerank_report(
        scored: &mut Vec<(f32, Record)>,
        belief_engine: &BeliefEngine,
        top_k: usize,
    ) -> recall::LimitedRerankReport {
        recall::apply_belief_rerank(scored, belief_engine, top_k)
    }

    pub(crate) fn recall_temporal(
        view: RecallPipelineView<'_>,
        query: &str,
        top_k: usize,
        min_strength: f32,
        expand_connections: bool,
        namespaces: Option<&[&str]>,
    ) -> Vec<(f32, Record)> {
        Self::raw(
            view,
            query,
            top_k,
            min_strength,
            expand_connections,
            namespaces,
        )
    }
}
