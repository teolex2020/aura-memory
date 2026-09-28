import os

os.chdir(r"D:\AuraSDK-public")


def edit(p, pairs):
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)


edit("src/security.rs", [
    ("""//! * `balanced` (default) — `recall()` returns the level-grouped context and
//!   `delete()` is a logical delete (bytes can remain in storage history until
//!   `purge_record` is called).
//! * `strict` — `recall()` returns the provenance context (first-hand memory
//!   separated from quoted, fenced untrusted memory; experiment E10) and
//!   `delete()` purges the record from storage, snapshots and audit history
//!   (experiment E1).""",
     """//! * `balanced` (default) — `delete()` is a logical delete (bytes can remain
//!   in storage history until `purge_record` is called).
//! * `strict` — `delete()` purges the record from storage, snapshots and
//!   audit history (experiment E1).
//!
//! In every profile `recall()` returns the provenance context: first-hand
//! memory separated from quoted, fenced untrusted memory (experiments E10,
//! E13, E14); `format="levels"` keeps the older level-grouped context."""),
    ("""    /// Records in those groups.
    pub records_in_groups_over_cap: usize,
}""",
     """    /// Records in those groups.
    pub records_in_groups_over_cap: usize,
    /// First-hand records whose write channel names an outside source.
    pub outside_channel_first_hand: usize,
}"""),
    ("""        if let Some(group) = crate::recall::untrusted_group(record) {
            *groups.entry(group).or_insert(0) += 1;
        }
    }""",
     """        if let Some(group) = crate::recall::untrusted_group(record) {
            *groups.entry(group).or_insert(0) += 1;
        }
        if let Some(channel) = meta("channel") {
            if crate::trust::source_type_for_channel(channel) != "recorded"
                && crate::certainty::effective_source_type(record) == "recorded"
            {
                stats.outside_channel_first_hand += 1;
            }
        }
    }"""),
    ("""            name: "provenance_context",
            state: if strict { "on" } else { "mcp_only" },
            evidence: "E10",
            detail: if strict {
                "recall() separates first-hand memory from fenced untrusted memory".into()
            } else {
                "MCP recall uses the provenance context; Python/Rust recall() needs format=\\"provenance\\" or the strict profile".into()
            },
        },""",
     """            name: "provenance_context",
            state: "on",
            evidence: "E10/E13/E14",
            detail: "recall() separates first-hand memory from fenced untrusted memory; format=\\"levels\\" opts out".into(),
        },"""),
    ("""    if stats.untrusted_groups_over_cap > 0 {""",
     """    if stats.outside_channel_first_hand > 0 {
        warnings.push(format!(
            "{} record(s) came through an outside channel but are marked first-hand: \\
             they appear as the user's own words; pass source_type or leave it to the channel",
            stats.outside_channel_first_hand
        ));
    }
    if stats.untrusted_groups_over_cap > 0 {"""),
])

edit("src/aura.rs", [
    ("""        stats.set_item("records_in_groups_over_cap", s.records_in_groups_over_cap)?;""",
     """        stats.set_item("records_in_groups_over_cap", s.records_in_groups_over_cap)?;
        stats.set_item("outside_channel_first_hand", s.outside_channel_first_hand)?;"""),
])
print("patched")
