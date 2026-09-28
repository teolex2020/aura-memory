import os
import re

os.chdir(r"D:\AuraSDK-public")


def edit(p, pairs):
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)


s = open("src/recall.rs", encoding="utf-8").read()

# 1. split causal parent lookup out of format_record
old_tail = """    // Append causal reasoning
    if let Some(ref caused_by) = rec.caused_by_id {
        if let Some(parent) = records.get(caused_by) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64();
            if parent.namespace == rec.namespace
                && parent.is_valid_at(now)
                && crate::acl::evaluate(parent, &crate::acl::AclContext::default()).allowed
            {
                let preview: String = parent.content.chars().take(120).collect();
                base.push_str(&format!("\\n    ^ because: {}", preview));
            }
        }
    }

    base
}"""
assert s.count(old_tail) == 1
s = s.replace(old_tail, """    // Append causal reasoning
    if let Some(parent) = causal_parent(rec, records) {
        let preview: String = parent.content.chars().take(120).collect();
        base.push_str(&format!("\\n    ^ because: {}", preview));
    }

    base
}

/// The visible causal parent of a record: same namespace, currently valid,
/// readable under the default ACL context.
fn causal_parent<'a>(rec: &Record, records: &'a HashMap<String, Record>) -> Option<&'a Record> {
    let parent = records.get(rec.caused_by_id.as_deref()?)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    (parent.namespace == rec.namespace
        && parent.is_valid_at(now)
        && crate::acl::evaluate(parent, &crate::acl::AclContext::default()).allowed)
        .then_some(parent)
}""")

# 2. replace format_provenance with the unified version
start = s.index("/// Context that separates first-hand user memory from untrusted memory.")
end = s.index("fn format_record(rec: &Record, records: &HashMap<String, Record>) -> String {")
s = s[:start] + '''/// Escape an untrusted value shown inline (channel names, tags).
fn inline_untrusted(value: &str) -> String {
    value
        .replace('[', "(")
        .replace(']', ")")
        .replace("===", "= = =")
        .replace(['\\n', '\\r'], " ")
}

fn semantic_label(rec: &Record) -> &'static str {
    match rec.semantic_type.as_str() {
        "decision" => " {decision}",
        "preference" => " {preference}",
        "trend" => " {trend}",
        "serendipity" => " {serendipity}",
        "contradiction" => " {contradiction}",
        _ => "",
    }
}

/// A first-hand record as in the level format, with the user's certainty
/// noted and a causal parent from an untrusted source quoted, not trusted.
fn format_first_hand(rec: &Record, records: &HashMap<String, Record>) -> String {
    let parentless = Record {
        caused_by_id: None,
        ..rec.clone()
    };
    let mut block = format_record(&parentless, records);
    let note = match rec
        .metadata
        .get(crate::certainty::META_CLAIM_CERTAINTY)
        .map(String::as_str)
    {
        Some("hearsay") => " (the user is relaying what they heard)",
        Some("speculative") => " (the user is unsure)",
        _ => "",
    };
    if !note.is_empty() {
        match block.find('\\n') {
            Some(at) => block.insert_str(at, note),
            None => block.push_str(note),
        }
    }
    if let Some(parent) = causal_parent(rec, records) {
        let preview: String = parent.content.chars().take(120).collect();
        if crate::certainty::effective_source_type(parent) == "recorded" {
            block.push_str(&format!("\\n    ^ because: {preview}"));
        } else {
            block.push_str(&format!(
                "\\n    ^ because (untrusted source): {}",
                inline_untrusted(&preview)
            ));
        }
    }
    block
}

/// An untrusted record: source line, then its text quoted line by line.
fn format_untrusted(rec: &Record, source: &str) -> String {
    let channel = rec
        .metadata
        .get("channel")
        .map(String::as_str)
        .unwrap_or(source);
    let tags = if rec.tags.is_empty() {
        String::new()
    } else {
        format!(" ({})", inline_untrusted(&rec.tags.join(", ")))
    };
    format!(
        "  - source: {}{}{}\\n{}",
        inline_untrusted(channel),
        semantic_label(rec),
        tags,
        quote_untrusted(&rec.content)
    )
}

/// Context that separates first-hand user memory from untrusted memory.
///
/// Records whose effective source (`certainty::effective_source_type`) is
/// `recorded` go under "FROM THE USER", grouped by level and shown as in
/// the level format (tags, semantic labels, code fences, causal parents).
/// Everything else is fenced under the untrusted header, with each line
/// quoted and structure characters escaped so an injected "[recorded] ..."
/// or "SYSTEM NOTE" reads as quoted data. Records are admitted in relevance
/// order until the token budget is spent; relevance order is kept within
/// each group.
pub fn format_provenance(
    scored: &[(f32, Record)],
    token_budget: usize,
    records: &HashMap<String, Record>,
) -> String {
    if scored.is_empty() {
        return String::new();
    }
    let mut trusted: Vec<(Level, String)> = Vec::new();
    let mut untrusted = Vec::new();
    let mut used = 0usize;
    for (_, rec) in scored {
        let source = crate::certainty::effective_source_type(rec);
        let is_trusted = source == "recorded";
        let block = if is_trusted {
            format_first_hand(rec, records)
        } else {
            format_untrusted(rec, source)
        };
        let cost = estimate_tokens(&block);
        if used + cost > token_budget {
            break;
        }
        used += cost;
        if is_trusted {
            trusted.push((rec.level, block));
        } else {
            untrusted.push(block);
        }
    }
    let mut output = String::from("=== MEMORY CONTEXT ===\\n");
    if !trusted.is_empty() {
        output.push_str("[FROM THE USER — first-hand]\\n");
        for level in [Level::Identity, Level::Domain, Level::Decisions, Level::Working] {
            let blocks: Vec<&str> = trusted
                .iter()
                .filter(|(l, _)| *l == level)
                .map(|(_, b)| b.as_str())
                .collect();
            if !blocks.is_empty() {
                output.push_str(&format!("({})\\n", level.name()));
                output.push_str(&blocks.join("\\n"));
                output.push('\\n');
            }
        }
        output.push('\\n');
    }
    if !untrusted.is_empty() {
        output.push_str(UNTRUSTED_HEADER);
        output.push('\\n');
        output.push_str(&untrusted.join("\\n"));
        output.push_str("\\n\\n");
    }
    output.push_str("=== END MEMORY CONTEXT ===");
    output
}

''' + s[end:]
s = s.replace("let out = format_provenance(&[(1.0, web), (0.9, user)], 2048);",
              "let out = format_provenance(&[(1.0, web), (0.9, user)], 2048, &HashMap::new());")
open("src/recall.rs", "w", encoding="utf-8", newline="").write(s)

# 3. aura.rs: provenance cached with its own key, default recall = provenance
edit("src/aura.rs", [
    ("""        if self.security_profile() == crate::security::SecurityProfile::Strict {
            return self.recall_provenance(
                query,
                token_budget,
                min_strength,
                expand_connections,
                session_id,
                namespaces,
            );
        }
        self.recall_levels(
            query,
            token_budget,
            min_strength,
            expand_connections,
            session_id,
            namespaces,
        )
    }""",
     """        self.recall_provenance(
            query,
            token_budget,
            min_strength,
            expand_connections,
            session_id,
            namespaces,
        )
    }"""),
    ("""    /// Recall formatted with provenance: first-hand user memory and untrusted
    /// memory in separate sections, untrusted text quoted and fenced (see
    /// `recall::format_provenance`). Not cached.
    pub fn recall_provenance(
        &self,
        query: &str,
        token_budget: Option<usize>,
        min_strength: Option<f32>,
        expand_connections: Option<bool>,
        session_id: Option<&str>,
        namespaces: Option<&[&str]>,
    ) -> Result<String> {
        let scored = self.recall_core(
            query,
            20,
            min_strength.unwrap_or(0.1),
            expand_connections.unwrap_or(true),
            session_id,
            namespaces,
        )?;
        let context = recall::format_provenance(&scored, token_budget.unwrap_or(2048));
        self.runtime.note_recall(usize::from(!context.is_empty()));
        Ok(context)
    }""",
     """    /// Recall formatted with provenance: first-hand user memory and untrusted
    /// memory in separate sections, untrusted text quoted and fenced (see
    /// `recall::format_provenance`). This is what `recall()` returns.
    pub fn recall_provenance(
        &self,
        query: &str,
        token_budget: Option<usize>,
        min_strength: Option<f32>,
        expand_connections: Option<bool>,
        session_id: Option<&str>,
        namespaces: Option<&[&str]>,
    ) -> Result<String> {
        if self.has_temporal_boundaries(namespaces) {
            self.runtime.clear_recall_caches();
        }
        let budget = token_budget.unwrap_or(2048);
        let result = RecallService::recall_formatted(
            &self.runtime.recall_cache,
            "provenance",
            query,
            budget,
            min_strength.unwrap_or(0.1),
            expand_connections.unwrap_or(true),
            session_id,
            namespaces,
            || {
                self.recall_core(
                    query,
                    20,
                    min_strength.unwrap_or(0.1),
                    expand_connections.unwrap_or(true),
                    session_id,
                    namespaces,
                )
            },
            |scored| {
                let records = self.records.read();
                recall::format_provenance(scored, budget, &records)
            },
        );
        if let Ok(ref context) = result {
            self.runtime.note_recall(usize::from(!context.is_empty()));
        }
        result
    }"""),
    ("""        let result = RecallService::recall_formatted(
            &self.runtime.recall_cache,
            query,
            budget,""",
     """        let result = RecallService::recall_formatted(
            &self.runtime.recall_cache,
            "levels",
            query,
            budget,"""),
])

edit("src/recall_service.rs", [
    ("""    pub(crate) fn recall_formatted<F, G>(
        cache: &RecallCache,
        query: &str,""",
     """    pub(crate) fn recall_formatted<F, G>(
        cache: &RecallCache,
        format: &str,
        query: &str,"""),
    ("""        let cache_key = format!(
            "{}:{token_budget}:{}:{expand_connections}",
            Self::text_cache_key(query, namespaces),""",
     """        let cache_key = format!(
            "{format}:{}:{token_budget}:{}:{expand_connections}",
            Self::text_cache_key(query, namespaces),"""),
])
print("patched")
