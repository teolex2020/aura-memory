import os

os.chdir(r"D:\AuraSDK-public")


def edit(p, pairs):
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)


edit("src/trust.rs", [
    ("/// Stamp provenance into record metadata.",
     """/// Source type implied by a write channel when the caller gives none.
///
/// Channels the user speaks through (`user`, `user-*`, `telegram`,
/// `desktop`, `voice`) and host configuration (`system`) are first-hand
/// (`recorded`); the agent's own writes (`agent`, `agent-*`) are `inferred`;
/// every other channel (`web_scrape`, `email`, `api`, ...) is outside
/// content (`retrieved`).
pub fn source_type_for_channel(channel: &str) -> &'static str {
    let channel = channel.trim().to_ascii_lowercase();
    if matches!(
        channel.as_str(),
        "user" | "telegram" | "desktop" | "voice" | "system"
    ) || channel.starts_with("user-")
    {
        "recorded"
    } else if channel == "agent" || channel.starts_with("agent-") {
        "inferred"
    } else {
        "retrieved"
    }
}

/// Stamp provenance into record metadata."""),
])

edit("src/aura.rs", [
    ("""        let source_type = source_type.unwrap_or(crate::record::DEFAULT_SOURCE_TYPE);
        crate::record::Record::validate_source_type(source_type).map_err(|e| anyhow::anyhow!(e))?;
        let deduplicate = deduplicate.unwrap_or(true);""",
     """        // An explicit source type wins; otherwise the write channel decides
        // (outside channels are untrusted), and no channel keeps the default.
        let source_type = source_type
            .or_else(|| channel.map(trust::source_type_for_channel))
            .unwrap_or(crate::record::DEFAULT_SOURCE_TYPE);
        crate::record::Record::validate_source_type(source_type).map_err(|e| anyhow::anyhow!(e))?;
        let deduplicate = deduplicate.unwrap_or(true);"""),
    ("""            trust::stamp_provenance(
                &mut rec.metadata,
                channel,
                &rec.tags,
                &taxonomy,
                &trust_config,
            );
        }
""",
     """            trust::stamp_provenance(
                &mut rec.metadata,
                channel,
                &rec.tags,
                &taxonomy,
                &trust_config,
            );
        }
        if let Some(channel) = channel {
            rec.metadata
                .entry("channel".to_string())
                .or_insert_with(|| channel.to_string());
        }
"""),
])
print("patched")
