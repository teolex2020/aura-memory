"""E26 test build: provenance context order variants U, UR, URD.

Applied to the commit after E25 for the scratch build only. Adds Python
`recall(format=...)` values "provenance_u", "provenance_ur", "provenance_urd"
(not cached). The pre-trust fused score of each recalled record is kept as
metadata "__relevance" so UR/URD can order by relevance.
"""

import os

os.chdir(r"D:\AuraSDK-public")


def edit(p, pairs):
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)


VARIANT = r'''
fn relevance_of(rec: &Record) -> f32 {
    rec.metadata
        .get("__relevance")
        .and_then(|v| v.parse::<f32>().ok())
        .unwrap_or(0.0)
}

/// E26 variants: "u" (untrusted section first, first-hand last), "ur" (U,
/// most relevant entry last in each section), "urd" (UR, dates without time).
pub fn format_provenance_variant(
    scored: &[(f32, Record)],
    token_budget: usize,
    records: &HashMap<String, Record>,
    dates: ContextDates,
    identity_block: &str,
    variant: &str,
) -> String {
    if scored.is_empty() && identity_block.is_empty() {
        return String::new();
    }
    let by_relevance = variant == "ur" || variant == "urd";
    let date_only = variant == "urd";
    let mut trusted: Vec<(f32, String)> = Vec::new();
    let mut untrusted: Vec<(f32, String)> = Vec::new();
    let mut used = 0usize;
    for (_, rec) in scored {
        let source = crate::certainty::effective_source_type(rec);
        let is_trusted = source == "recorded";
        let block = if is_trusted {
            let mut block = format_first_hand(rec, records, false);
            if dates != ContextDates::Off {
                let date = rec
                    .metadata
                    .get("timestamp")
                    .and_then(|raw| chrono::DateTime::parse_from_rfc3339(raw).ok())
                    .map(|at| {
                        at.format(if date_only { "%Y-%m-%d" } else { "%Y-%m-%d %H:%M" })
                            .to_string()
                    });
                if let (Some(date), Some(rest)) = (date, block.strip_prefix("  - ")) {
                    block = format!("  - [{date}] {rest}");
                }
            }
            block
        } else {
            let channel = rec
                .metadata
                .get("channel")
                .map(String::as_str)
                .unwrap_or(source);
            format!(
                "  - source: {}{}\n{}",
                inline_untrusted(channel),
                semantic_label(rec),
                quote_untrusted(&rec.content)
            )
        };
        let cost = estimate_tokens(&block);
        if used + cost > token_budget {
            break;
        }
        used += cost;
        let relevance = relevance_of(rec);
        if is_trusted {
            trusted.push((relevance, block));
        } else {
            untrusted.push((relevance, block));
        }
    }
    if by_relevance {
        // Most relevant last: next to the question.
        let order = |a: &(f32, String), b: &(f32, String)| {
            a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
        };
        trusted.sort_by(order);
        untrusted.sort_by(order);
    }
    let mut output = String::from("=== MEMORY CONTEXT ===\n");
    if !untrusted.is_empty() {
        if dates == ContextDates::Off {
            output.push_str(UNTRUSTED_HEADER);
        } else {
            let open = UNTRUSTED_HEADER
                .strip_suffix(']')
                .unwrap_or(UNTRUSTED_HEADER);
            output.push_str(open);
            output.push_str(UNTRUSTED_DATE_NOTE);
            output.push(']');
        }
        output.push('\n');
        let blocks: Vec<&str> = untrusted.iter().map(|(_, b)| b.as_str()).collect();
        output.push_str(&blocks.join("\n"));
        output.push_str("\n\n");
    }
    output.push_str(identity_block);
    if !trusted.is_empty() {
        output.push_str("[FROM THE USER — first-hand]\n");
        let blocks: Vec<&str> = trusted.iter().map(|(_, b)| b.as_str()).collect();
        output.push_str(&blocks.join("\n"));
        output.push_str("\n\n");
    }
    output.push_str("=== END MEMORY CONTEXT ===");
    output
}

'''

s = open("src/recall.rs", encoding="utf-8").read()
anchor = "fn format_record(rec: &Record, records: &HashMap<String, Record>) -> String {"
assert s.count(anchor) == 1
s = s.replace(anchor, VARIANT.lstrip("\n") + anchor)
old = """    for (score, rec) in matched.iter_mut() {
        let effective_trust =
            trust::compute_effective_trust(&rec.metadata, now_unix, config, &rec.source_type);
        *score = *score * rec.strength * effective_trust;
    }"""
assert s.count(old) == 1
s = s.replace(old, """    for (score, rec) in matched.iter_mut() {
        rec.metadata
            .insert("__relevance".to_string(), format!("{:.9}", *score));
        let effective_trust =
            trust::compute_effective_trust(&rec.metadata, now_unix, config, &rec.source_type);
        *score = *score * rec.strength * effective_trust;
    }""")
open("src/recall.rs", "w", encoding="utf-8", newline="").write(s)

edit("src/aura.rs", [
    ("""    /// Recall structured (raw results with trust scoring).""",
     """    /// E26 test build: provenance context order variant. Not cached.
    pub fn recall_provenance_variant(&self, query: &str, variant: &str) -> Result<String> {
        let budget = 2048usize;
        let scored = self.recall_core(query, 20, 0.1, true, None, None)?;
        let records = self.records.read();
        let default_ns = [crate::record::DEFAULT_NAMESPACE];
        let (block, used) = if self.identity_block_enabled() {
            recall::identity_block(&records, &scored, &default_ns, budget / recall::IDENTITY_BLOCK_SHARE)
        } else {
            (String::new(), 0)
        };
        Ok(recall::format_provenance_variant(
            &scored,
            budget.saturating_sub(used),
            &records,
            self.context_dates(),
            &block,
            variant,
        ))
    }

    /// Recall structured (raw results with trust scoring)."""),
    ("""        let provenance = match format {
            None => None,""",
     """        if let Some(variant) = format.and_then(|f| f.strip_prefix("provenance_")) {
            let variant = variant.to_string();
            return py
                .allow_threads(|| self.recall_provenance_variant(query, &variant))
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()));
        }
        let provenance = match format {
            None => None,"""),
])
print("variants patched")
