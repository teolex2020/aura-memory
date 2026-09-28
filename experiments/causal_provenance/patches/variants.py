"""E14b test build: provenance format variants F, P1, P2, P3, C.

Applied to the commit after E14 (15c5f4e) for the scratch build only. Adds
`recall::format_provenance_variant` and Python `recall(format=...)` values
"provenance_p1", "provenance_p2", "provenance_p3", "provenance_causal".
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
/// Escape an untrusted value shown inline (channel names, tags, previews).
fn inline_untrusted(value: &str) -> String {
    value
        .replace('[', "(")
        .replace(']', ")")
        .replace("===", "= = =")
        .replace(['\n', '\r'], " ")
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

fn certainty_note(rec: &Record) -> &'static str {
    match rec
        .metadata
        .get(crate::certainty::META_CLAIM_CERTAINTY)
        .map(String::as_str)
    {
        Some("hearsay") => " (the user is relaying what they heard)",
        Some("speculative") => " (the user is unsure)",
        _ => "",
    }
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
}

/// A first-hand entry as in the level format (tags, semantic label, code
/// fence), the user's certainty noted, and its causal parent shown; a parent
/// from an untrusted source is marked and escaped instead of trusted.
fn format_first_hand_causal(rec: &Record, records: &HashMap<String, Record>) -> String {
    let parentless = Record {
        caused_by_id: None,
        ..rec.clone()
    };
    let mut block = format_record(&parentless, records);
    let note = certainty_note(rec);
    if !note.is_empty() {
        match block.find('\n') {
            Some(at) => block.insert_str(at, note),
            None => block.push_str(note),
        }
    }
    if let Some(parent) = causal_parent(rec, records) {
        let preview: String = parent.content.chars().take(120).collect();
        if crate::certainty::effective_source_type(parent) == "recorded" {
            block.push_str(&format!("\n    ^ because: {preview}"));
        } else {
            block.push_str(&format!(
                "\n    ^ because (untrusted source): {}",
                inline_untrusted(&preview)
            ));
        }
    }
    block
}

/// E14b variants of the provenance context: "flat" (F), "p1", "p2", "p3"
/// (meaning-neutral perturbations of F) and "causal" (C).
pub fn format_provenance_variant(
    scored: &[(f32, Record)],
    token_budget: usize,
    records: &HashMap<String, Record>,
    variant: &str,
) -> String {
    if scored.is_empty() {
        return String::new();
    }
    let bullet = if variant == "p2" { "•" } else { "-" };
    let causal = variant == "causal";
    let mut trusted = Vec::new();
    let mut untrusted = Vec::new();
    let mut used = 0usize;
    for (_, rec) in scored {
        let source = crate::certainty::effective_source_type(rec);
        let is_trusted = source == "recorded";
        let block = if is_trusted {
            if causal {
                format_first_hand_causal(rec, records)
            } else {
                format!("  {bullet} {}{}", rec.content, certainty_note(rec))
            }
        } else {
            let channel = rec
                .metadata
                .get("channel")
                .map(String::as_str)
                .unwrap_or(source);
            let label = if causal { semantic_label(rec) } else { "" };
            format!(
                "  {bullet} source: {}{label}\n{}",
                inline_untrusted(channel),
                quote_untrusted(&rec.content)
            )
        };
        let cost = estimate_tokens(&block);
        if used + cost > token_budget {
            break;
        }
        used += cost;
        if is_trusted {
            trusted.push(block);
        } else {
            untrusted.push(block);
        }
    }
    let mut output = String::from("=== MEMORY CONTEXT ===\n");
    if !trusted.is_empty() {
        output.push_str("[FROM THE USER — first-hand]\n");
        if variant == "p1" {
            output.push_str("(entries)\n");
        }
        let separator = if variant == "p3" { "\n\n" } else { "\n" };
        output.push_str(&trusted.join(separator));
        output.push_str("\n\n");
    }
    if !untrusted.is_empty() {
        output.push_str(UNTRUSTED_HEADER);
        output.push('\n');
        output.push_str(&untrusted.join("\n"));
        output.push_str("\n\n");
    }
    output.push_str("=== END MEMORY CONTEXT ===");
    output
}

'''

s = open("src/recall.rs", encoding="utf-8").read()
already = "pub fn format_provenance_variant(" in s
anchor = "fn format_record(rec: &Record, records: &HashMap<String, Record>) -> String {"
assert s.count(anchor) == 1
s = s.replace(anchor, VARIANT.lstrip("\n") + anchor)
open("src/recall.rs", "w", encoding="utf-8", newline="").write(s)

edit("src/aura.rs", [
    ("""    /// Recall structured (raw results with trust scoring).""",
     """    /// E14b test build: provenance context variant (see
    /// `recall::format_provenance_variant`). Not cached.
    pub fn recall_provenance_variant(
        &self,
        query: &str,
        token_budget: Option<usize>,
        namespaces: Option<&[&str]>,
        variant: &str,
    ) -> Result<String> {
        let scored = self.recall_core(query, 20, 0.1, true, None, namespaces)?;
        let records = self.records.read();
        Ok(recall::format_provenance_variant(
            &scored,
            token_budget.unwrap_or(2048),
            &records,
            variant,
        ))
    }

    /// Recall structured (raw results with trust scoring)."""),
    ("""        let provenance = match format {
            None => None,
            Some("levels") => Some(false),""",
     """        if let Some(variant) = format.and_then(|f| f.strip_prefix("provenance_")) {
            let variant = variant.to_string();
            return py
                .allow_threads(|| {
                    self.recall_provenance_variant(query, token_budget, ns_slice, &variant)
                })
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()));
        }
        let provenance = match format {
            None => None,
            Some("levels") => Some(false),"""),
])
print("variants patched")
