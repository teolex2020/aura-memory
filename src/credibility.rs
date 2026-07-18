//! Source credibility — domain reputation scoring.
//!
//! Rewritten from source_credibility.py.

use std::collections::HashMap;

/// Default credibility score for unknown domains.
const DEFAULT_SCORE: f32 = 0.50;

/// Source credibility scorer with domain reputation table.
pub struct SourceCredibility {
    /// Domain → credibility score (0.0-1.0).
    cache: HashMap<String, f32>,
    /// User overrides take priority.
    user_overrides: HashMap<String, f32>,
}

impl SourceCredibility {
    pub fn new() -> Self {
        let mut cache = HashMap::new();

        // Medical / Scientific (High Trust)
        cache.insert("pubmed.ncbi.nlm.nih.gov".into(), 0.95);
        cache.insert("ncbi.nlm.nih.gov".into(), 0.95);
        cache.insert("who.int".into(), 0.95);
        cache.insert("cdc.gov".into(), 0.95);
        cache.insert("mayoclinic.org".into(), 0.90);
        cache.insert("clevelandclinic.org".into(), 0.90);
        cache.insert("hopkinsmedicine.org".into(), 0.90);
        cache.insert("medlineplus.gov".into(), 0.90);
        cache.insert("sciencedirect.com".into(), 0.85);
        cache.insert("nature.com".into(), 0.90);
        cache.insert("bmj.com".into(), 0.90);
        cache.insert("thelancet.com".into(), 0.90);
        cache.insert("webmd.com".into(), 0.70);
        cache.insert("healthline.com".into(), 0.65);
        cache.insert("medicalnewstoday.com".into(), 0.65);

        // Academic / Reference (High Trust)
        cache.insert("arxiv.org".into(), 0.90);
        cache.insert("scholar.google.com".into(), 0.85);
        cache.insert("wikipedia.org".into(), 0.75);
        cache.insert("britannica.com".into(), 0.85);

        // News (Medium-High Trust)
        cache.insert("bbc.com".into(), 0.80);
        cache.insert("reuters.com".into(), 0.85);
        cache.insert("apnews.com".into(), 0.85);
        cache.insert("npr.org".into(), 0.80);
        cache.insert("nytimes.com".into(), 0.80);
        cache.insert("wsj.com".into(), 0.80);
        cache.insert("economist.com".into(), 0.85);
        cache.insert("bloomberg.com".into(), 0.80);

        // Tech (Medium Trust)
        cache.insert("stackoverflow.com".into(), 0.75);
        cache.insert("github.com".into(), 0.70);
        cache.insert("docs.rs".into(), 0.80);
        cache.insert("docs.python.org".into(), 0.85);
        cache.insert("developer.mozilla.org".into(), 0.85);
        cache.insert("rust-lang.org".into(), 0.85);

        // Social / UGC (Lower Trust)
        cache.insert("reddit.com".into(), 0.40);
        cache.insert("quora.com".into(), 0.35);
        cache.insert("twitter.com".into(), 0.30);
        cache.insert("x.com".into(), 0.30);
        cache.insert("facebook.com".into(), 0.25);
        cache.insert("instagram.com".into(), 0.25);
        cache.insert("tiktok.com".into(), 0.20);
        cache.insert("youtube.com".into(), 0.40);
        cache.insert("medium.com".into(), 0.50);
        cache.insert("linkedin.com".into(), 0.50);

        Self {
            cache,
            user_overrides: HashMap::new(),
        }
    }

    /// Extract clean domain from URL.
    fn extract_domain(url: &str) -> Option<String> {
        let url = if !url.starts_with("http://") && !url.starts_with("https://") {
            format!("https://{}", url)
        } else {
            url.to_string()
        };

        // Simple URL parsing without pulling in the url crate
        let after_scheme = url.split("://").nth(1)?;
        let host = after_scheme.split('/').next()?;
        let mut domain = host.to_lowercase();
        if domain.starts_with("www.") {
            domain = domain[4..].to_string();
        }
        // Remove port
        if let Some(idx) = domain.find(':') {
            domain = domain[..idx].to_string();
        }
        Some(domain)
    }

    /// Get credibility score for a URL (0.0-1.0).
    pub fn get_score(&self, url: &str) -> f32 {
        if url.is_empty() {
            return DEFAULT_SCORE;
        }

        let domain = match Self::extract_domain(url) {
            Some(d) => d,
            None => return DEFAULT_SCORE,
        };

        // Check user overrides first
        if let Some(&score) = self.user_overrides.get(&domain) {
            return score;
        }

        // Check exact match
        if let Some(&score) = self.cache.get(&domain) {
            return score;
        }

        // Check parent domain (e.g., sub.example.com → example.com)
        let parts: Vec<&str> = domain.split('.').collect();
        if parts.len() > 2 {
            let parent = parts[parts.len() - 2..].join(".");
            if let Some(&score) = self.cache.get(&parent) {
                return score;
            }
        }

        DEFAULT_SCORE
    }

    /// Set user override for a domain.
    pub fn set_override(&mut self, domain: &str, score: f32) {
        let domain = domain.to_lowercase();
        self.user_overrides.insert(domain, score.clamp(0.0, 1.0));
    }

    /// Remove user override for a domain.
    pub fn remove_override(&mut self, domain: &str) {
        self.user_overrides.remove(&domain.to_lowercase());
    }

    /// Get all user overrides.
    pub fn get_overrides(&self) -> &HashMap<String, f32> {
        &self.user_overrides
    }
}

impl Default for SourceCredibility {
    fn default() -> Self {
        Self::new()
    }
}

// ── Born-from-collision provenance (orthogonal credibility axis) ──

/// How a belief came to exist — a *provenance kind* axis that is independent of
/// `SourceCredibility` (which scores *where* a claim's domain ranks).
///
/// The same domain can carry both a lived consequence and a generated
/// description, so this is NOT a domain score. It captures the §11.4
/// "born-from-collision" distinction from the Aura research line:
///
///   * `LivedConsequence` — the belief exists because an action was actually
///     taken and a convergent world returned a result the agent did not know in
///     advance (a tool ran, a test passed/failed, a fetch returned). It was
///     *born from a collision with the world*.
///   * `ExternalSource` — the belief was read from an external source (a page,
///     a document). Real, but not executed by this agent.
///   * `ModelGenerated` — the belief was produced by a frozen model describing
///     what is plausible. It is a *description*, and a description can be filled
///     in with fluent text without any collision — so it is the weakest kind.
///
/// A lived consequence should outweigh a model-generated description of the same
/// claim even when their domain credibility is equal: that is the guard against
/// a confident-but-unverified generation winning by fluency alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ProvenanceKind {
    /// Weakest: generated by a frozen model (a description, no collision).
    ModelGenerated,
    /// Read from an external source; real but not executed by this agent.
    ExternalSource,
    /// Strongest: born from a real action + verified world consequence.
    LivedConsequence,
}

impl ProvenanceKind {
    /// Credibility multiplier applied on top of any domain/source score.
    ///
    /// Lived consequence is rewarded above 1.0; a bare model generation is
    /// damped below 1.0. Deterministic constants, no tuning loop.
    pub fn trust_multiplier(self) -> f32 {
        match self {
            ProvenanceKind::LivedConsequence => 1.30,
            ProvenanceKind::ExternalSource => 1.00,
            ProvenanceKind::ModelGenerated => 0.70,
        }
    }

    /// Infer the provenance kind from a unit's provenance strings (the same
    /// `provenance: Vec<String>` carried by `ConsequenceUnit`).
    ///
    /// Provenance entries are STRUCTURED tags, e.g. `"sdk:capture_consequence"`,
    /// `"tool:fetch"`, `"remy:cycle_recorder"`, `"world:cargo test"`. We match on
    /// whole TOKENS (split on `:`, `/`, `|`, and whitespace), not bare
    /// substrings — so a free-text entry like "latest world news" does NOT count
    /// as an executed-world marker. Deterministic, case-insensitive, no semantics.
    ///
    /// A token naming an executed world (tool/cargo/test/exec/fetch/world/capture/
    /// cycle_recorder) marks a lived consequence; a token naming a model/LLM marks
    /// a generation; otherwise it is treated as an external source.
    pub fn from_provenance(provenance: &[String]) -> Self {
        // Strong, unambiguous lived markers — matched as whole tokens anywhere
        // (these never appear as ordinary prose words in a provenance tag).
        const LIVED_STRONG: &[&str] = &[
            "capture_consequence",
            "cargo",
            "cycle_recorder",
            "exec",
            "fetch",
        ];
        // Generic words (tool/test/world) only count as a lived marker when they
        // are the STRUCTURED NAMESPACE PREFIX of an entry (e.g. "tool:fetch",
        // "world:cargo test"), NOT when they merely appear in free text.
        const LIVED_PREFIX: &[&str] = &["tool", "test", "world", "sdk"];
        const MODEL: &[&str] = &["llm", "model", "generated"];

        let tokens_of = |raw: &str| -> Vec<String> {
            raw.to_ascii_lowercase()
                .split(|c: char| c == ':' || c == '/' || c == '|' || c.is_whitespace())
                .filter(|t| !t.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        };
        // The namespace prefix is the token before the first ':' (if any).
        let prefix_of = |raw: &str| -> String {
            raw.to_ascii_lowercase()
                .split(':')
                .next()
                .unwrap_or("")
                .trim()
                .to_string()
        };

        let mut saw_external = false;
        let mut saw_model = false;
        for raw in provenance {
            let tokens = tokens_of(raw);
            let prefix = prefix_of(raw);
            let lived = tokens.iter().any(|t| LIVED_STRONG.contains(&t.as_str()))
                || LIVED_PREFIX.contains(&prefix.as_str());
            if lived {
                // A lived marker anywhere wins immediately.
                return ProvenanceKind::LivedConsequence;
            }
            if tokens.iter().any(|t| MODEL.contains(&t.as_str())) {
                saw_model = true;
                continue;
            }
            if !tokens.is_empty() {
                saw_external = true;
            }
        }
        if saw_external {
            ProvenanceKind::ExternalSource
        } else if saw_model {
            ProvenanceKind::ModelGenerated
        } else {
            // No provenance at all is treated as a description, not a collision.
            ProvenanceKind::ModelGenerated
        }
    }

    /// Infer the provenance kind of a stored `Record`.
    ///
    /// Precedence (strongest signal wins):
    ///   1. a `consequence-support`/`consequence-refute` tag is DEFINITIONAL — the
    ///      record came from a lived outcome, regardless of what its provenance
    ///      strings happen to be named → `LivedConsequence`. (This must be checked
    ///      FIRST: a host agent's provenance vocabulary, e.g. `remy:factuality_runtime`,
    ///      is not in the SDK's marker list, so deferring to `from_provenance` would
    ///      wrongly demote a real lived scar to `ExternalSource`.)
    ///   2. otherwise, an explicit `cu_provenance` whose tokens name an executed
    ///      world (`from_provenance`);
    ///   3. otherwise fall back to the record's `source_type`
    ///      (`recorded`/`retrieved` = external, `generated`/`inferred` = model).
    pub fn from_record(record: &crate::record::Record) -> Self {
        // 1. The consequence polarity tag is the authoritative lived signal: a
        //    captured support/refute IS a lived consequence by construction.
        let lived_tag = record.tags.iter().any(|t| {
            t == crate::consequence::CONSEQUENCE_SUPPORT_TAG
                || t == crate::consequence::CONSEQUENCE_REFUTE_TAG
        });
        if lived_tag {
            return ProvenanceKind::LivedConsequence;
        }
        // 2. No lived tag — consult structured provenance tokens.
        if let Some(prov) = record.metadata.get(crate::consequence::META_PROVENANCE) {
            let entries: Vec<String> = prov
                .lines()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .collect();
            if !entries.is_empty() {
                return Self::from_provenance(&entries);
            }
        }
        // 3. Fall back to source_type.
        match record.source_type.as_str() {
            "recorded" | "retrieved" => ProvenanceKind::ExternalSource,
            "generated" | "inferred" => ProvenanceKind::ModelGenerated,
            _ => ProvenanceKind::ExternalSource,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ProvenanceKind::LivedConsequence => "lived_consequence",
            ProvenanceKind::ExternalSource => "external_source",
            ProvenanceKind::ModelGenerated => "model_generated",
        }
    }
}

/// Combine a domain/source credibility score with a provenance kind into a
/// single effective credibility, clamped to [0, 1].
///
/// This is the §11.4 guard in one call: a lived consequence from a mid-trust
/// domain can outrank a model-generated claim from a high-trust domain, because
/// being *born from a collision* is worth more than where the description came
/// from.
pub fn effective_credibility(domain_score: f32, provenance: ProvenanceKind) -> f32 {
    (domain_score * provenance.trust_multiplier()).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_domain() {
        let cred = SourceCredibility::new();
        assert_eq!(cred.get_score("https://arxiv.org/paper/123"), 0.90);
        assert_eq!(cred.get_score("https://reddit.com/r/rust"), 0.40);
    }

    #[test]
    fn test_unknown_domain() {
        let cred = SourceCredibility::new();
        assert_eq!(
            cred.get_score("https://random-blog.xyz/post"),
            DEFAULT_SCORE
        );
    }

    #[test]
    fn test_parent_domain_fallback() {
        let cred = SourceCredibility::new();
        // sub.reddit.com should match reddit.com
        assert_eq!(cred.get_score("https://old.reddit.com/r/rust"), 0.40);
    }

    #[test]
    fn test_www_stripping() {
        let cred = SourceCredibility::new();
        assert_eq!(cred.get_score("https://www.nature.com/articles/123"), 0.90);
    }

    #[test]
    fn test_user_override() {
        let mut cred = SourceCredibility::new();
        cred.set_override("my-company.com", 0.9);
        assert_eq!(cred.get_score("https://my-company.com/docs"), 0.9);
    }

    #[test]
    fn test_no_scheme() {
        let cred = SourceCredibility::new();
        assert_eq!(cred.get_score("nature.com/articles/123"), 0.90);
    }

    // ── Born-from-collision provenance (§11.4) ──

    #[test]
    fn provenance_kind_orders_lived_above_generated() {
        assert!(ProvenanceKind::LivedConsequence > ProvenanceKind::ExternalSource);
        assert!(ProvenanceKind::ExternalSource > ProvenanceKind::ModelGenerated);
        assert!(
            ProvenanceKind::LivedConsequence.trust_multiplier()
                > ProvenanceKind::ModelGenerated.trust_multiplier()
        );
    }

    #[test]
    fn from_provenance_detects_lived_consequence() {
        let p = vec!["sdk:capture_consequence".to_string(), "cycle:7".to_string()];
        assert_eq!(
            ProvenanceKind::from_provenance(&p),
            ProvenanceKind::LivedConsequence
        );
        let cargo = vec!["world:cargo test".to_string()];
        assert_eq!(
            ProvenanceKind::from_provenance(&cargo),
            ProvenanceKind::LivedConsequence
        );
    }

    #[test]
    fn from_record_trusts_consequence_tag_over_host_provenance() {
        use crate::levels::Level;
        use crate::record::Record;

        // A real lived REFUTES scar captured by a host agent (health-secretary)
        // carries a consequence-refute tag AND a host-namespaced provenance
        // ("remy:factuality_runtime") the SDK's marker list does not know. The
        // consequence tag is definitional and MUST win — the record is a lived
        // consequence, not an external source.
        let mut scar = Record::new("[CONSEQUENCE] ...".into(), Level::Decisions);
        scar.tags
            .push(crate::consequence::CONSEQUENCE_REFUTE_TAG.to_string());
        scar.metadata.insert(
            crate::consequence::META_PROVENANCE.to_string(),
            "remy:factuality_runtime\ncycle:5\nverdict:refuted".to_string(),
        );
        assert_eq!(
            ProvenanceKind::from_record(&scar),
            ProvenanceKind::LivedConsequence,
            "a consequence-refute tag must classify lived regardless of host provenance vocabulary"
        );

        // Same for a support outcome with an unknown host provenance.
        let mut support = Record::new("ok".into(), Level::Decisions);
        support
            .tags
            .push(crate::consequence::CONSEQUENCE_SUPPORT_TAG.to_string());
        support.metadata.insert(
            crate::consequence::META_PROVENANCE.to_string(),
            "remy:autonomy_advance_plan".to_string(),
        );
        assert_eq!(
            ProvenanceKind::from_record(&support),
            ProvenanceKind::LivedConsequence
        );
    }

    #[test]
    fn from_provenance_does_not_mislabel_prose_as_lived() {
        // Free-text prose that merely CONTAINS a marker word as a substring must
        // NOT be promoted to LivedConsequence — only structured tokens count.
        let prose = vec!["latest world news summary".to_string()];
        assert_ne!(
            ProvenanceKind::from_provenance(&prose),
            ProvenanceKind::LivedConsequence,
            "prose containing 'world' must not be read as an executed-world marker"
        );
        let contested = vec!["a test of someones patience".to_string()];
        assert_ne!(
            ProvenanceKind::from_provenance(&contested),
            ProvenanceKind::LivedConsequence
        );
        // But a STRUCTURED marker token still works.
        assert_eq!(
            ProvenanceKind::from_provenance(&["world:cargo test".to_string()]),
            ProvenanceKind::LivedConsequence
        );
        assert_eq!(
            ProvenanceKind::from_provenance(&["tool:fetch".to_string()]),
            ProvenanceKind::LivedConsequence
        );
    }

    #[test]
    fn from_provenance_detects_model_generated() {
        let p = vec!["llm:generated".to_string()];
        assert_eq!(
            ProvenanceKind::from_provenance(&p),
            ProvenanceKind::ModelGenerated
        );
        // No provenance at all is a description, not a collision.
        assert_eq!(
            ProvenanceKind::from_provenance(&[]),
            ProvenanceKind::ModelGenerated
        );
    }

    #[test]
    fn lived_marker_wins_even_alongside_model_marker() {
        // A unit captured by a tool but also tagged with the model that proposed
        // it is still a lived consequence — the collision happened.
        let p = vec!["llm:gpt".to_string(), "tool:fetch".to_string()];
        assert_eq!(
            ProvenanceKind::from_provenance(&p),
            ProvenanceKind::LivedConsequence
        );
    }

    #[test]
    fn lived_consequence_outranks_generated_high_trust_domain() {
        // THE §11.4 GUARD: a lived consequence from a mid-trust domain (0.70)
        // beats a fluent model-generated claim from a top-trust domain (0.95).
        let lived_mid = effective_credibility(0.70, ProvenanceKind::LivedConsequence);
        let generated_high = effective_credibility(0.95, ProvenanceKind::ModelGenerated);
        assert!(
            lived_mid > generated_high,
            "lived {lived_mid} should outrank generated {generated_high}"
        );
    }

    #[test]
    fn effective_credibility_is_clamped() {
        // High domain × lived multiplier must not exceed 1.0.
        assert!(effective_credibility(0.95, ProvenanceKind::LivedConsequence) <= 1.0);
        assert!(effective_credibility(0.0, ProvenanceKind::ModelGenerated) >= 0.0);
    }

    #[test]
    fn from_record_reads_consequence_tags_then_source_type() {
        use crate::levels::Level;
        use crate::record::Record;

        // A record carrying a consequence-support tag is a lived consequence.
        let mut lived = Record::new("x".into(), Level::Working);
        lived
            .tags
            .push(crate::consequence::CONSEQUENCE_SUPPORT_TAG.to_string());
        assert_eq!(
            ProvenanceKind::from_record(&lived),
            ProvenanceKind::LivedConsequence
        );

        // A plain generated record falls back to model-generated by source_type.
        let mut gen = Record::new("y".into(), Level::Working);
        gen.source_type = "generated".to_string();
        assert_eq!(
            ProvenanceKind::from_record(&gen),
            ProvenanceKind::ModelGenerated
        );

        // A recorded record with no consequence tag is an external source.
        let mut ext = Record::new("z".into(), Level::Working);
        ext.source_type = "recorded".to_string();
        assert_eq!(
            ProvenanceKind::from_record(&ext),
            ProvenanceKind::ExternalSource
        );
    }
}
