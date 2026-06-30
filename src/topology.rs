//! Substrate-native graph topology primitive.
//!
//! A pure physical graph layer ported from the Aura research brain
//! (`core/topology.rs`). [`NodeId`] is `u64` — the same node-id width
//! already used across the SDK (see [`crate::neighbor_mass`], which keys
//! its role-similarity footprints on `u64` neighbor ids). Edges carry a
//! `weight: f32` capped at [`EDGE_WEIGHT_CAP`]. Nothing else: no Record,
//! no text, no tags, no source_type. Topology operates over node ids and
//! edge weights; what those ids mean is the caller's concern.
//!
//! # Why this exists
//!
//! Before this module the SDK represented inter-record structure as an
//! ad-hoc `connections: HashMap<String, f32>` on each [`Record`], which
//! `causal`, `neighbor_mass`, and consolidation each re-walked
//! independently (e.g. `causal.rs` re-derives an edge weight via
//! `rec.connections.get(id).copied().unwrap_or(0.5)`). `Topology` is the
//! single shared, decayable, weighted substrate those layers can read
//! from, so reinforcement and decay stay consistent instead of being
//! re-implemented per consumer.
//!
//! # Substrate-truth boundaries
//!   - Self-edges are invalid topology — every operation that would
//!     create or operate on one returns `Err`.
//!   - Establishment is idempotent: [`Topology::connect_bidirectional`]
//!     on an existing edge is a no-op. Reinforcement is an explicit
//!     separate operation ([`Topology::reinforce_edge`]).
//!   - Queries on unknown nodes return empty / zero, not `Err`.
//!     Topology state queries fail soft; topology mutations fail loud.
//!   - Merge weight collisions: keep = `max(w_keep, w_remove)`. Two
//!     equivalent nodes' assertions to the same neighbor are not
//!     independent evidence; max preserves the strongest assertion
//!     without inflating duplicates.
//!
//! # Persistence
//!
//! Unlike the research brain (which persisted through a bespoke binary
//! `topology.bin` / `binfmt` format), this port uses the SDK's serde
//! convention. [`TopologyStore`] mirrors `causal::CausalStore`: it
//! serializes to `topology.cog` under a directory and round-trips inside
//! the existing cognitive-snapshot/sealed-state mechanism. Missing file
//! on load yields an empty [`Topology`] (first run).
//!
//! [`Record`]: crate::record::Record

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Node identifier. `u64` to match the SDK's existing node-id width
/// (see [`crate::neighbor_mass`]).
pub type NodeId = u64;

// FNV-1a 64-bit constants — the same basis/prime `neighbor_mass` uses,
// so a record's node id is computed identically wherever the SDK turns a
// string record id into a u64.
const FNV_OFFSET_BASIS_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;

/// Deterministic map from a string record id to a topology [`NodeId`].
///
/// `Record.id` is a `String`; the topology substrate is keyed on `u64`.
/// This is the single bridge between the two, so the same record always
/// resolves to the same node across `recall` (reinforcement) and
/// `causal` (read). FNV-1a over the full id keeps collisions on the full
/// 64-bit space negligible (unlike the deliberately-lossy 512-bit bloom
/// footprint in [`crate::neighbor_mass`], which is a different mechanism).
pub fn node_id_for(record_id: &str) -> NodeId {
    let mut hash = FNV_OFFSET_BASIS_64;
    for byte in record_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME_64);
    }
    hash
}

/// One outgoing edge in the directed adjacency representation. The
/// public API exposes bidirectional connect/reinforce; storage stays
/// directed because that is the more general primitive.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub target: NodeId,
    pub weight: f32,
}

/// Maximum edge weight. Reinforcement saturates here.
pub const EDGE_WEIGHT_CAP: f32 = 1.0;

/// Substrate-native graph. Directed adjacency under the hood;
/// bidirectional helpers maintain symmetric pairs at the API level.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Topology {
    edges: HashMap<NodeId, Vec<Edge>>,
}

impl Topology {
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of distinct nodes that appear as edge sources. Zero on
    /// an empty topology. Note: a node mentioned only as an edge
    /// target (without outgoing edges) does not count here.
    pub fn node_count(&self) -> usize {
        self.edges.len()
    }

    /// Total edge entries across all sources (counts both directions
    /// for a bidirectional pair).
    pub fn edge_count(&self) -> usize {
        self.edges.values().map(|v| v.len()).sum()
    }

    /// Establish a symmetric pair of directed edges between `a` and
    /// `b` with the given weight. Idempotent: if an edge already
    /// exists in either direction, that direction is left alone (use
    /// [`Topology::reinforce_edge`] to grow weight).
    ///
    /// Errors:
    ///   - self-edge (`a == b`) is invalid topology.
    ///   - weight outside `[0.0, EDGE_WEIGHT_CAP]` is invalid.
    pub fn connect_bidirectional(&mut self, a: NodeId, b: NodeId, weight: f32) -> Result<()> {
        if a == b {
            return Err(anyhow!(
                "topology: self-edge ({a}) is invalid; topology has no self-loops"
            ));
        }
        if !(weight.is_finite() && (0.0..=EDGE_WEIGHT_CAP).contains(&weight)) {
            return Err(anyhow!(
                "topology: weight {weight} out of range [0.0, {EDGE_WEIGHT_CAP}]"
            ));
        }
        Self::insert_directed_idempotent(&mut self.edges, a, b, weight);
        Self::insert_directed_idempotent(&mut self.edges, b, a, weight);
        Ok(())
    }

    /// Increase the weight of an existing directed pair (both a→b and
    /// b→a) by `delta`, saturating at [`EDGE_WEIGHT_CAP`]. If either
    /// direction is missing, that direction is created at the
    /// saturated value `delta.min(EDGE_WEIGHT_CAP)` so reinforcement
    /// of an unestablished pair behaves as a fresh connect at strength
    /// `delta`.
    ///
    /// Errors:
    ///   - self-reinforcement (`a == b`).
    ///   - non-finite or negative `delta`.
    pub fn reinforce_edge(&mut self, a: NodeId, b: NodeId, delta: f32) -> Result<()> {
        if a == b {
            return Err(anyhow!("topology: cannot reinforce self-edge ({a})"));
        }
        if !delta.is_finite() || delta < 0.0 {
            return Err(anyhow!("topology: reinforce delta {delta} must be >= 0"));
        }
        Self::reinforce_directed(&mut self.edges, a, b, delta);
        Self::reinforce_directed(&mut self.edges, b, a, delta);
        Ok(())
    }

    /// Decrease the weight of an existing symmetric edge pair by
    /// `delta`, then prune any direction whose resulting weight is
    /// below `prune_below`.
    ///
    /// This is the edge-local counterpart to [`Topology::decay_edges`]:
    /// callers can weaken a specific noisy path without globally aging
    /// the whole topology. Missing directions are no-ops; unknown state
    /// fails soft, invalid mutation parameters fail loud.
    ///
    /// Returns the number of directed edge entries pruned.
    ///
    /// Errors:
    ///   - self-weakening (`a == b`).
    ///   - non-finite or negative `delta`.
    ///   - invalid `prune_below`.
    pub fn weaken_edge(
        &mut self,
        a: NodeId,
        b: NodeId,
        delta: f32,
        prune_below: f32,
    ) -> Result<usize> {
        if a == b {
            return Err(anyhow!("topology: cannot weaken self-edge ({a})"));
        }
        if !delta.is_finite() || delta < 0.0 {
            return Err(anyhow!("topology: weaken delta {delta} must be >= 0"));
        }
        if !(prune_below.is_finite() && (0.0..=EDGE_WEIGHT_CAP).contains(&prune_below)) {
            return Err(anyhow!(
                "topology: prune_below {prune_below} out of range [0.0, {EDGE_WEIGHT_CAP}]"
            ));
        }
        let mut pruned = 0usize;
        pruned += Self::weaken_directed(&mut self.edges, a, b, delta, prune_below);
        pruned += Self::weaken_directed(&mut self.edges, b, a, delta, prune_below);
        Ok(pruned)
    }

    /// Decay every directed topology edge by `rate`, then prune edges
    /// whose resulting weight is below `prune_below`.
    ///
    /// This is a physical aging primitive, not a scheduler: callers
    /// choose exactly when to invoke it and with which parameters
    /// (e.g. from `maintenance_service`).
    ///
    /// Returns the number of directed edge entries pruned. Sources that
    /// lose every outgoing edge are removed so [`Topology::node_count`]
    /// and [`Topology::edge_count`] keep matching stored topology truth.
    ///
    /// Errors:
    ///   - `rate` must be finite and in `[0.0, 1.0]`.
    ///   - `prune_below` must be finite and in `[0.0, EDGE_WEIGHT_CAP]`.
    pub fn decay_edges(&mut self, rate: f32, prune_below: f32) -> Result<usize> {
        if !(rate.is_finite() && (0.0..=1.0).contains(&rate)) {
            return Err(anyhow!("topology: decay rate {rate} out of range [0.0, 1.0]"));
        }
        if !(prune_below.is_finite() && (0.0..=EDGE_WEIGHT_CAP).contains(&prune_below)) {
            return Err(anyhow!(
                "topology: prune_below {prune_below} out of range [0.0, {EDGE_WEIGHT_CAP}]"
            ));
        }

        let mut pruned = 0usize;
        for neighbours in self.edges.values_mut() {
            for edge in neighbours.iter_mut() {
                edge.weight *= rate;
            }
            let before = neighbours.len();
            neighbours.retain(|edge| edge.weight >= prune_below);
            pruned += before - neighbours.len();
        }
        self.edges.retain(|_, neighbours| !neighbours.is_empty());
        Ok(pruned)
    }

    /// Remove `node_id` and every edge that touches it, in either
    /// direction. Used to keep topology consistent with the identity
    /// layer when a fact dies.
    ///
    /// Returns `true` if the call mutated state (the node had
    /// outbound edges, OR appeared as the target of any other node's
    /// edge), `false` if the node was already absent everywhere.
    /// Substrate-truth: removing an unknown node is a no-op, not an
    /// error — queries on unknown state fail soft.
    pub fn remove_node(&mut self, node_id: NodeId) -> bool {
        let outbound_removed = self.edges.remove(&node_id).is_some();

        // Strip inbound edges from every other node's neighbour list.
        // Drop neighbour vectors that empty out as a result so
        // `node_count` and `edge_count` reflect the change correctly.
        let mut sources_emptied: Vec<NodeId> = Vec::new();
        let mut inbound_removed = false;
        for (source, neighbours) in self.edges.iter_mut() {
            let before = neighbours.len();
            neighbours.retain(|edge| edge.target != node_id);
            if neighbours.len() != before {
                inbound_removed = true;
                if neighbours.is_empty() {
                    sources_emptied.push(*source);
                }
            }
        }
        for source in sources_emptied {
            self.edges.remove(&source);
        }

        outbound_removed || inbound_removed
    }

    /// Iterator over every node id that appears as an edge source.
    /// A node that appears only as an edge target (no outgoing edges
    /// of its own) is NOT yielded — same definition as
    /// [`Topology::node_count`].
    pub fn source_ids(&self) -> impl Iterator<Item = NodeId> + '_ {
        self.edges.keys().copied()
    }

    /// Sorted list of distinct neighbor ids reachable from `id`.
    /// Returns an empty `Vec` for an unknown id (substrate-truth:
    /// queries on unknown state fail soft).
    pub fn neighbor_set(&self, id: NodeId) -> Vec<NodeId> {
        match self.edges.get(&id) {
            None => Vec::new(),
            Some(edges) => {
                let mut ids: Vec<NodeId> = edges.iter().map(|e| e.target).collect();
                ids.sort_unstable();
                ids.dedup();
                ids
            }
        }
    }

    /// Raw outgoing edges of `id` as a borrowed slice. Unknown id
    /// returns an empty slice (substrate-truth: queries on unknown
    /// state fail soft). Pure read; no mutation.
    ///
    /// Where [`Topology::neighbor_set`] deduplicates and discards
    /// weights, `neighbor_edges` exposes the structural truth — edges
    /// with their weights, in storage order. The runtime API never
    /// produces duplicate targets per source.
    pub fn neighbor_edges(&self, id: NodeId) -> &[Edge] {
        match self.edges.get(&id) {
            None => &[],
            Some(list) => list.as_slice(),
        }
    }

    /// Whether `id` appears anywhere in the topology — either as an
    /// edge source (i.e., has outgoing edges) or as an edge target.
    /// Substrate-truth: a node added only as someone else's neighbour
    /// IS present in the topology, even though it never originated an
    /// edge of its own.
    ///
    /// Unknown id -> `false`. No mutation. `O(total edges)` worst case
    /// because we may have to scan every edge target.
    pub fn contains_node(&self, id: NodeId) -> bool {
        if self.edges.contains_key(&id) {
            return true;
        }
        for neighbours in self.edges.values() {
            if neighbours.iter().any(|e| e.target == id) {
                return true;
            }
        }
        false
    }

    /// Edge weight from `a` to `b` if it exists.
    pub fn edge_weight(&self, a: NodeId, b: NodeId) -> Option<f32> {
        self.edges
            .get(&a)?
            .iter()
            .find(|e| e.target == b)
            .map(|e| e.weight)
    }

    /// Unweighted Jaccard over neighbor ids.
    ///
    /// ```text
    /// tanimoto_neighbors(a, b) = |N(a) ∩ N(b)| / |N(a) ∪ N(b)|
    /// ```
    ///
    /// Returns 0.0 if either node is unknown or both have empty
    /// neighbor sets. The metric is purely topological — it ignores
    /// edge weights. For weight-aware overlap, use
    /// [`Topology::weighted_neighbor_overlap`].
    ///
    /// Note: this is exact-set Jaccard over the live adjacency.
    /// [`crate::neighbor_mass`] offers a complementary bloom-footprint
    /// Jaccard (`NeighborMassFootprint::overlap`) intended for
    /// persisted per-entity role footprints; prefer this method when
    /// you already hold the topology and want exact overlap.
    pub fn tanimoto_neighbors(&self, a: NodeId, b: NodeId) -> f32 {
        let na = self.neighbor_id_set(a);
        let nb = self.neighbor_id_set(b);
        if na.is_empty() && nb.is_empty() {
            return 0.0;
        }
        let intersection = na.intersection(&nb).count() as f32;
        let union = na.union(&nb).count() as f32;
        if union == 0.0 {
            0.0
        } else {
            intersection / union
        }
    }

    /// Weighted overlap over neighbor sets:
    ///
    /// ```text
    ///   sum over common neighbors n: min(w_a→n, w_b→n)
    ///   ─────────────────────────────────────────────
    ///   sum over union neighbors  n: max(w_a→n, w_b→n)
    /// ```
    ///
    /// Returns 0.0 if either node is unknown or there are no edges to
    /// share. Substrate-truth reading: how much the connection
    /// strengths of `a` and `b` actually overlap, not just whether
    /// they share neighbors.
    pub fn weighted_neighbor_overlap(&self, a: NodeId, b: NodeId) -> f32 {
        let edges_a = self.edge_map(a);
        let edges_b = self.edge_map(b);
        if edges_a.is_empty() && edges_b.is_empty() {
            return 0.0;
        }
        let mut union_keys: HashSet<NodeId> = HashSet::new();
        union_keys.extend(edges_a.keys().copied());
        union_keys.extend(edges_b.keys().copied());

        let mut min_sum = 0.0_f32;
        let mut max_sum = 0.0_f32;
        for n in union_keys {
            let wa = edges_a.get(&n).copied().unwrap_or(0.0);
            let wb = edges_b.get(&n).copied().unwrap_or(0.0);
            min_sum += wa.min(wb);
            max_sum += wa.max(wb);
        }
        if max_sum <= 0.0 {
            0.0
        } else {
            min_sum / max_sum
        }
    }

    /// Merge `remove` into `keep`. All edges that mention `remove` are
    /// rewired so they touch `keep` instead. After merge, `remove` is
    /// completely absent from adjacency (no outgoing edges, no inbound
    /// edges).
    ///
    /// Weight collision policy: when both `keep→x` and `remove→x`
    /// existed pre-merge, the merged `keep→x` weight is the **max** of
    /// the two. Two equivalent nodes' assertions to the same neighbor
    /// are not independent evidence; max preserves the strongest
    /// assertion without inflating duplicates.
    ///
    /// No self-loops are created. If `keep ↔ remove` existed pre-merge,
    /// it disappears (not converted to a self-loop).
    ///
    /// Errors:
    ///   - keep == remove.
    ///   - either node is absent from topology.
    pub fn merge_nodes(&mut self, keep: NodeId, remove: NodeId) -> Result<()> {
        if keep == remove {
            return Err(anyhow!(
                "topology::merge: keep and remove are the same node ({keep})"
            ));
        }
        if !self.edges.contains_key(&keep) {
            return Err(anyhow!(
                "topology::merge: keep node {keep} is not present in topology"
            ));
        }
        if !self.edges.contains_key(&remove) {
            return Err(anyhow!(
                "topology::merge: remove node {remove} is not present in topology"
            ));
        }

        // 1. Take the outgoing edges of `remove` so we can rewire them
        //    onto `keep`. Drop any edge to `keep` (no self-loop).
        let removed_out = self.edges.remove(&remove).unwrap_or_default();
        for edge in removed_out {
            if edge.target == keep {
                continue; // would become self-loop on keep
            }
            Self::insert_or_max(&mut self.edges, keep, edge.target, edge.weight);
        }

        // 2. Walk every other source's edges and rewire any edge whose
        //    target was `remove` so that it now points to `keep`.
        let other_sources: Vec<NodeId> = self.edges.keys().copied().collect();
        for src in other_sources {
            if src == keep {
                // keep's own edges: drop any that targeted `remove`
                // (rewiring would become self-loop).
                if let Some(list) = self.edges.get_mut(&keep) {
                    list.retain(|e| e.target != remove);
                }
                continue;
            }
            let Some(list) = self.edges.get_mut(&src) else {
                continue;
            };
            // Collect rewires from this source.
            let mut rewires: Vec<f32> = Vec::new();
            list.retain(|e| {
                if e.target == remove {
                    rewires.push(e.weight);
                    false
                } else {
                    true
                }
            });
            // Apply each rewire to src→keep with max policy.
            for w in rewires {
                Self::insert_or_max_into_list(list, keep, w);
            }
        }

        // 3. After rewiring, drop entries that have no outgoing edges.
        self.edges.retain(|_, list| !list.is_empty());

        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────

    fn insert_directed_idempotent(
        edges: &mut HashMap<NodeId, Vec<Edge>>,
        from: NodeId,
        to: NodeId,
        weight: f32,
    ) {
        let list = edges.entry(from).or_default();
        if list.iter().any(|e| e.target == to) {
            return; // idempotent: existing edge unchanged
        }
        list.push(Edge { target: to, weight });
    }

    fn reinforce_directed(
        edges: &mut HashMap<NodeId, Vec<Edge>>,
        from: NodeId,
        to: NodeId,
        delta: f32,
    ) {
        let list = edges.entry(from).or_default();
        if let Some(e) = list.iter_mut().find(|e| e.target == to) {
            e.weight = (e.weight + delta).min(EDGE_WEIGHT_CAP);
        } else {
            // Reinforcement of a pair that didn't yet exist: create at
            // the saturated value.
            list.push(Edge {
                target: to,
                weight: delta.min(EDGE_WEIGHT_CAP),
            });
        }
    }

    fn weaken_directed(
        edges: &mut HashMap<NodeId, Vec<Edge>>,
        from: NodeId,
        to: NodeId,
        delta: f32,
        prune_below: f32,
    ) -> usize {
        let Some(list) = edges.get_mut(&from) else {
            return 0;
        };
        let Some(pos) = list.iter().position(|edge| edge.target == to) else {
            return 0;
        };
        let weakened = (list[pos].weight - delta).max(0.0);
        if weakened < prune_below {
            list.remove(pos);
            if list.is_empty() {
                edges.remove(&from);
            }
            1
        } else {
            list[pos].weight = weakened;
            0
        }
    }

    fn insert_or_max(
        edges: &mut HashMap<NodeId, Vec<Edge>>,
        from: NodeId,
        to: NodeId,
        weight: f32,
    ) {
        let list = edges.entry(from).or_default();
        Self::insert_or_max_into_list(list, to, weight);
    }

    fn insert_or_max_into_list(list: &mut Vec<Edge>, to: NodeId, weight: f32) {
        if let Some(e) = list.iter_mut().find(|e| e.target == to) {
            if weight > e.weight {
                e.weight = weight.min(EDGE_WEIGHT_CAP);
            }
        } else {
            list.push(Edge {
                target: to,
                weight: weight.min(EDGE_WEIGHT_CAP),
            });
        }
    }

    fn neighbor_id_set(&self, id: NodeId) -> HashSet<NodeId> {
        match self.edges.get(&id) {
            None => HashSet::new(),
            Some(list) => list.iter().map(|e| e.target).collect(),
        }
    }

    fn edge_map(&self, id: NodeId) -> HashMap<NodeId, f32> {
        match self.edges.get(&id) {
            None => HashMap::new(),
            Some(list) => list.iter().map(|e| (e.target, e.weight)).collect(),
        }
    }
}

/// Disk persistence for [`Topology`], mirroring `causal::CausalStore`.
///
/// Serializes to `topology.cog` under a directory using the SDK's serde
/// convention (rather than the research brain's bespoke binary
/// `topology.bin` format), so the substrate round-trips inside the
/// existing cognitive-snapshot/sealed-state mechanism.
#[derive(Debug)]
pub struct TopologyStore {
    path: std::path::PathBuf,
}

impl TopologyStore {
    pub fn new<P: AsRef<Path>>(path: P) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }

    /// Persist topology state to `<path>/topology.cog`.
    pub fn save(&self, topology: &Topology) -> Result<()> {
        std::fs::create_dir_all(&self.path)
            .with_context(|| format!("topology::save: create_dir_all {}", self.path.display()))?;
        let file_path = self.path.join("topology.cog");
        let data = serde_json::to_vec(topology).context("topology::save: serialize")?;
        std::fs::write(&file_path, data)
            .with_context(|| format!("topology::save: write {}", file_path.display()))?;
        Ok(())
    }

    /// Load topology state from `<path>/topology.cog`. Missing file
    /// yields an empty [`Topology`] (first run).
    pub fn load(&self) -> Result<Topology> {
        let file_path = self.path.join("topology.cog");
        if !file_path.exists() {
            return Ok(Topology::new());
        }
        let data = std::fs::read(&file_path)
            .with_context(|| format!("topology::load: read {}", file_path.display()))?;
        let topology: Topology =
            serde_json::from_slice(&data).context("topology::load: deserialize")?;
        Ok(topology)
    }
}

// ════════════════════════════════════════════════════════════
// Unit tests
//
// The research-brain original carried coverage indirectly through its
// integration suite. This port ships fresh in-file unit tests for the
// substrate-truth invariants flagged in the audit: saturation, idempotent
// connect, decay+prune, remove_node cleanup, merge collision policy, the
// two similarity metrics, and serde round-trip.
// ════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_id_for_is_deterministic_and_distinct() {
        assert_eq!(node_id_for("rec-a"), node_id_for("rec-a"));
        assert_ne!(node_id_for("rec-a"), node_id_for("rec-b"));
        // empty id is stable too
        assert_eq!(node_id_for(""), node_id_for(""));
    }

    #[test]
    fn new_topology_is_empty() {
        let t = Topology::new();
        assert_eq!(t.node_count(), 0);
        assert_eq!(t.edge_count(), 0);
    }

    #[test]
    fn connect_is_symmetric_and_counts_both_directions() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        assert_eq!(t.node_count(), 2);
        assert_eq!(t.edge_count(), 2); // 1->2 and 2->1
        assert_eq!(t.edge_weight(1, 2), Some(0.5));
        assert_eq!(t.edge_weight(2, 1), Some(0.5));
    }

    #[test]
    fn connect_rejects_self_edge() {
        let mut t = Topology::new();
        assert!(t.connect_bidirectional(7, 7, 0.5).is_err());
        assert_eq!(t.edge_count(), 0);
    }

    #[test]
    fn connect_rejects_out_of_range_weight() {
        let mut t = Topology::new();
        assert!(t.connect_bidirectional(1, 2, 1.5).is_err());
        assert!(t.connect_bidirectional(1, 2, -0.1).is_err());
        assert!(t.connect_bidirectional(1, 2, f32::NAN).is_err());
        assert_eq!(t.edge_count(), 0);
    }

    #[test]
    fn connect_is_idempotent_and_does_not_overwrite_weight() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        t.connect_bidirectional(1, 2, 0.9).unwrap(); // no-op on weight
        assert_eq!(t.edge_count(), 2);
        assert_eq!(t.edge_weight(1, 2), Some(0.5));
    }

    #[test]
    fn reinforce_saturates_at_cap() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.8).unwrap();
        t.reinforce_edge(1, 2, 0.5).unwrap();
        assert_eq!(t.edge_weight(1, 2), Some(EDGE_WEIGHT_CAP));
        assert_eq!(t.edge_weight(2, 1), Some(EDGE_WEIGHT_CAP));
    }

    #[test]
    fn reinforce_missing_pair_creates_at_saturated_delta() {
        let mut t = Topology::new();
        t.reinforce_edge(3, 4, 0.3).unwrap();
        assert_eq!(t.edge_weight(3, 4), Some(0.3));
        assert_eq!(t.edge_weight(4, 3), Some(0.3));
    }

    #[test]
    fn reinforce_rejects_self_and_negative() {
        let mut t = Topology::new();
        assert!(t.reinforce_edge(1, 1, 0.1).is_err());
        assert!(t.reinforce_edge(1, 2, -0.1).is_err());
    }

    #[test]
    fn weaken_prunes_below_threshold() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.3).unwrap();
        let pruned = t.weaken_edge(1, 2, 0.25, 0.1).unwrap();
        assert_eq!(pruned, 2); // both directions drop below 0.1 (0.05)
        assert_eq!(t.edge_count(), 0);
    }

    #[test]
    fn weaken_keeps_above_threshold() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.8).unwrap();
        let pruned = t.weaken_edge(1, 2, 0.2, 0.1).unwrap();
        assert_eq!(pruned, 0);
        let w = t.edge_weight(1, 2).unwrap();
        assert!((w - 0.6).abs() < 1e-6, "expected ~0.6 got {w}");
    }

    #[test]
    fn decay_ages_and_prunes_then_drops_empty_sources() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.2).unwrap();
        t.connect_bidirectional(1, 3, 0.9).unwrap();
        // rate 0.5 -> 1<->2 becomes 0.1, 1<->3 becomes 0.45
        let pruned = t.decay_edges(0.5, 0.2).unwrap();
        assert_eq!(pruned, 2); // both directions of 1<->2 fall below 0.2
        assert_eq!(t.edge_weight(1, 2), None);
        assert!(t.edge_weight(1, 3).is_some());
        // node 2 had only the edge to 1, which is gone -> source dropped
        assert!(t.neighbor_edges(2).is_empty());
    }

    #[test]
    fn decay_rejects_bad_params() {
        let mut t = Topology::new();
        assert!(t.decay_edges(1.5, 0.1).is_err());
        assert!(t.decay_edges(0.5, 2.0).is_err());
    }

    #[test]
    fn remove_node_cleans_inbound_and_outbound() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        t.connect_bidirectional(2, 3, 0.5).unwrap();
        assert!(t.remove_node(2));
        // node 2 fully gone from both 1's and 3's neighbour lists
        assert!(t.neighbor_edges(1).is_empty());
        assert!(t.neighbor_edges(3).is_empty());
        assert!(!t.contains_node(2));
        assert_eq!(t.edge_count(), 0);
    }

    #[test]
    fn remove_unknown_node_is_noop() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        assert!(!t.remove_node(99));
        assert_eq!(t.edge_count(), 2);
    }

    #[test]
    fn merge_uses_max_weight_collision_policy() {
        let mut t = Topology::new();
        // keep=1 and remove=2 both connect to neighbor 3, different weights
        t.connect_bidirectional(1, 3, 0.4).unwrap();
        t.connect_bidirectional(2, 3, 0.7).unwrap();
        t.merge_nodes(1, 2).unwrap();
        // remove=2 is gone, keep=1->3 takes the max (0.7)
        assert!(!t.contains_node(2));
        assert_eq!(t.edge_weight(1, 3), Some(0.7));
    }

    #[test]
    fn merge_does_not_create_self_loop() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap(); // keep <-> remove edge
        t.connect_bidirectional(2, 3, 0.5).unwrap();
        t.merge_nodes(1, 2).unwrap();
        assert_eq!(t.edge_weight(1, 1), None); // no self loop
        assert_eq!(t.edge_weight(1, 3), Some(0.5)); // rewired from 2->3
    }

    #[test]
    fn merge_rejects_absent_or_identical_nodes() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        assert!(t.merge_nodes(1, 1).is_err());
        assert!(t.merge_nodes(1, 99).is_err()); // 99 absent
        assert!(t.merge_nodes(99, 1).is_err()); // 99 absent
    }

    #[test]
    fn tanimoto_neighbors_is_set_jaccard() {
        let mut t = Topology::new();
        // a=1 neighbors {2,3,4}; b=10 neighbors {3,4,5}
        for n in [2u64, 3, 4] {
            t.connect_bidirectional(1, n, 0.5).unwrap();
        }
        for n in [3u64, 4, 5] {
            t.connect_bidirectional(10, n, 0.5).unwrap();
        }
        // intersection {3,4}=2, union {2,3,4,5}=4 -> 0.5
        let s = t.tanimoto_neighbors(1, 10);
        assert!((s - 0.5).abs() < 1e-6, "expected 0.5 got {s}");
        assert_eq!(t.tanimoto_neighbors(1, 999), 0.0); // unknown -> 0
    }

    #[test]
    fn weighted_neighbor_overlap_uses_min_over_max() {
        let mut t = Topology::new();
        // shared neighbor 3: weights 0.4 vs 0.8 -> min 0.4 / max 0.8
        t.connect_bidirectional(1, 3, 0.4).unwrap();
        t.connect_bidirectional(2, 3, 0.8).unwrap();
        let s = t.weighted_neighbor_overlap(1, 2);
        assert!((s - 0.5).abs() < 1e-6, "expected 0.5 got {s}");
    }

    #[test]
    fn serde_round_trip_preserves_topology() {
        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        t.connect_bidirectional(2, 3, 0.7).unwrap();
        t.reinforce_edge(1, 2, 0.2).unwrap();

        let json = serde_json::to_vec(&t).unwrap();
        let back: Topology = serde_json::from_slice(&json).unwrap();

        assert_eq!(back.node_count(), t.node_count());
        assert_eq!(back.edge_count(), t.edge_count());
        assert_eq!(back.edge_weight(1, 2), t.edge_weight(1, 2));
        assert_eq!(back.edge_weight(2, 3), t.edge_weight(2, 3));
    }

    #[test]
    fn topology_store_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("aura_topology_test_{}", std::process::id()));
        let store = TopologyStore::new(&dir);

        // missing file -> empty
        let empty = store.load().unwrap();
        assert_eq!(empty.edge_count(), 0);

        let mut t = Topology::new();
        t.connect_bidirectional(1, 2, 0.5).unwrap();
        t.connect_bidirectional(3, 4, 0.9).unwrap();
        store.save(&t).unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded.edge_count(), 4);
        assert_eq!(loaded.edge_weight(1, 2), Some(0.5));
        assert_eq!(loaded.edge_weight(3, 4), Some(0.9));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
