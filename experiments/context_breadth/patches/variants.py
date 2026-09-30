"""E28 test build: provenance context breadth variants.

Applied to the committed core for a scratch build only. Adds Python
`recall(format=...)` values "provenance_k10", "provenance_k40",
"provenance_rel" (not cached). The fused relevance of each recalled record
before recency/trust weighting is kept as metadata "__relevance" for REL.
"""

import os

os.chdir(r"D:\AuraSDK-public")


def edit(p, pairs):
    s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)


edit("src/recall.rs", [
    ("""    for (score, rec) in matched.iter_mut() {
        let effective_trust =
            trust::compute_effective_trust(&rec.metadata, now_unix, config, &rec.source_type);
        *score = *score * rec.strength * effective_trust;
    }""",
     """    for (score, rec) in matched.iter_mut() {
        rec.metadata
            .insert("__relevance".to_string(), format!("{:.9}", *score));
        let effective_trust =
            trust::compute_effective_trust(&rec.metadata, now_unix, config, &rec.source_type);
        *score = *score * rec.strength * effective_trust;
    }"""),
])

edit("src/aura.rs", [
    ("""    /// Recall structured (raw results with trust scoring).""",
     """    /// E28 test build: provenance context with a chosen breadth. Not cached.
    pub fn recall_provenance_breadth(
        &self,
        query: &str,
        top_k: usize,
        budget: usize,
        relevance_cut: Option<f32>,
    ) -> Result<String> {
        let mut scored = self.recall_core(query, top_k, 0.1, true, None, None)?;
        if let Some(cut) = relevance_cut {
            let rel = |r: &Record| {
                r.metadata
                    .get("__relevance")
                    .and_then(|v| v.parse::<f32>().ok())
                    .unwrap_or(0.0)
            };
            let best = scored.iter().map(|(_, r)| rel(r)).fold(0.0f32, f32::max);
            let mut kept = 0usize;
            scored.retain(|(_, r)| {
                let keep = kept < 5 || rel(r) >= cut * best;
                if keep {
                    kept += 1;
                }
                keep
            });
        }
        let records = self.records.read();
        let default_ns = [crate::record::DEFAULT_NAMESPACE];
        let (block, used) = if self.identity_block_enabled() {
            recall::identity_block(&records, &scored, &default_ns, budget / recall::IDENTITY_BLOCK_SHARE)
        } else {
            (String::new(), 0)
        };
        let context = recall::format_provenance(
            &scored,
            budget.saturating_sub(used),
            &records,
            self.context_dates(),
        );
        Ok(format!("{block}{context}"))
    }

    /// Recall structured (raw results with trust scoring)."""),
    ("""        let provenance = match format {
            None => None,""",
     """        let breadth = match format {
            Some("provenance_k10") => Some((10usize, 2048usize, None)),
            Some("provenance_k40") => Some((40, 8192, None)),
            Some("provenance_rel") => Some((40, 8192, Some(0.5f32))),
            _ => None,
        };
        if let Some((top_k, budget, cut)) = breadth {
            return py
                .allow_threads(|| self.recall_provenance_breadth(query, top_k, budget, cut))
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()));
        }
        let provenance = match format {
            None => None,"""),
])
print("E28 variants patched")
