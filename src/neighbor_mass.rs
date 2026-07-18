//! Neighbor-mass overlap — role similarity as overlap of EXTERNAL interaction
//! mass, not entity identity.
//!
//! The idea (from the Aura research line): an entity's *role* is the set of
//! OTHER entities it interacts with (its "neighbor mass"), and two entities are
//! role-similar when those neighbor sets OVERLAP — measured by a normalized
//! Jaccard, not by raw shared-neighbor count and not by entity identity.
//!
//! Why this matters over plain SDR/tag similarity: it predicts a missing link
//! THROUGH shared intermediaries. Two drugs can be role-similar because they
//! touch overlapping gene/target sets, even if their names/descriptions share
//! nothing.
//!
//! **Provenance of the proof — read this before citing numbers.** The proven
//! +2.6pp CTD result (role ≈67% vs entity-prior ≈64.5% on ~48K auxiliary-holdout
//! pairs) was produced with **exact-set** Jaccard over Python sets, NOT with the
//! bloom footprint below. This module ports the bloom *layout* from Aura's
//! `consequence_microregion_presence_footprint_from_units_v0` (8×u64, 3 FNV
//! hashes/neighbor), whose own proof line is the finance signal. So: the bloom
//! is a faithful port of that footprint mechanism, but the +2.6pp link-prediction
//! number is NOT a guarantee for the lossy bloom — it was measured on exact sets.
//! For small/medium neighbor sets the bloom approximates exact Jaccard closely;
//! at high degree it does not (see the degree caveat below). When you need the
//! proven-accuracy guarantee, prefer exact-set Jaccard over a 512-bit bloom.
//!
//! **Degree caveat (the bloom is NOT degree-immune).** A 512-bit / 3-hash
//! footprint saturates as the neighbor count grows: two GENUINELY DISJOINT
//! entities accrue rising false overlap with degree (empirically ≈0.10 at
//! degree 30, ≈0.30 at 80, ≈0.5 at 120 as the footprint fills toward 512 bits).
//! So `overlap` is reliable only while footprints are sparse (roughly degree
//! ≤ ~50 with this layout); above that, the floor rises and disjoint hubs look
//! spuriously similar. Use exact-set Jaccard, or a wider footprint, for
//! high-degree entities.
//!
//! Honest boundary (from the underlying proof): role overlap is LINK PREDICTION
//! in a graph whose entities are already seen via other pairings (auxiliary
//! pair-holdout). It is NOT both-entity transfer (block-wide holdout collapses to
//! chance) and NOT generic understanding. The signal comes from the FACT of
//! overlap and dies under label-shuffle (structure, not frequency).

use serde::{Deserialize, Serialize};

#[cfg(feature = "python")]
use pyo3::prelude::*;

/// 8 × u64 = 512-bit presence footprint (matches the proven Aura layout).
pub const NEIGHBOR_MASS_FOOTPRINT_WORDS: usize = 8;
/// Hashes set per neighbor id (bloom-style presence), matches the proof.
pub const NEIGHBOR_MASS_HASHES_PER_NEIGHBOR: u8 = 3;

const FNV_OFFSET_BASIS_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;

fn fnv64(bytes: &[u8]) -> u64 {
    let mut hash = FNV_OFFSET_BASIS_64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME_64);
    }
    hash
}

/// A presence footprint over an entity's neighbor mass.
///
/// Each distinct neighbor id lights `NEIGHBOR_MASS_HASHES_PER_NEIGHBOR` bits.
/// Role similarity is the normalized Jaccard of two footprints' bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "python", pyclass)]
pub struct NeighborMassFootprint {
    words: [u64; NEIGHBOR_MASS_FOOTPRINT_WORDS],
}

impl Default for NeighborMassFootprint {
    fn default() -> Self {
        Self {
            words: [0u64; NEIGHBOR_MASS_FOOTPRINT_WORDS],
        }
    }
}

impl NeighborMassFootprint {
    /// Build a footprint from an entity's neighbor ids (deduplicated).
    ///
    /// `neighbors` are the ids of the OTHER entities this one interacts with —
    /// e.g. the gene/target ids a drug acts on. Order and multiplicity do not
    /// matter; only the *set* of neighbors shapes the role.
    pub fn from_neighbors(neighbors: &[u64]) -> Self {
        let mut fp = Self::default();
        // Dedup so a neighbor seen twice does not light extra bits.
        let mut seen = std::collections::BTreeSet::new();
        for &n in neighbors {
            if !seen.insert(n) {
                continue;
            }
            for salt in 0..NEIGHBOR_MASS_HASHES_PER_NEIGHBOR {
                let mut bytes = Vec::with_capacity(9);
                bytes.push(salt);
                bytes.extend_from_slice(&n.to_le_bytes());
                let total_bits = (NEIGHBOR_MASS_FOOTPRINT_WORDS as u64) * 64;
                let bit = (fnv64(&bytes) % total_bits) as usize;
                fp.words[bit / 64] |= 1u64 << (bit % 64);
            }
        }
        fp
    }

    /// Number of set bits (population) of this footprint.
    pub fn popcount(&self) -> u32 {
        self.words.iter().map(|w| w.count_ones()).sum()
    }

    /// Bits in common with another footprint (intersection population).
    pub fn intersection_count(&self, other: &Self) -> u32 {
        self.words
            .iter()
            .zip(other.words.iter())
            .map(|(a, b)| (a & b).count_ones())
            .sum()
    }

    /// Bits in either footprint (union population).
    pub fn union_count(&self, other: &Self) -> u32 {
        self.words
            .iter()
            .zip(other.words.iter())
            .map(|(a, b)| (a | b).count_ones())
            .sum()
    }

    /// Normalized Jaccard overlap in [0, 1]. Two entities with no shared
    /// neighbors score 0; identical neighbor masses score 1. This normalization
    /// (over the union) is what the proof showed beats raw shared-count, which
    /// leaks popularity.
    pub fn overlap(&self, other: &Self) -> f32 {
        let union = self.union_count(other);
        if union == 0 {
            return 0.0;
        }
        self.intersection_count(other) as f32 / union as f32
    }
}

/// Role similarity between two entities given their neighbor masses.
///
/// Convenience over [`NeighborMassFootprint::from_neighbors`] +
/// [`NeighborMassFootprint::overlap`]: pass each entity's neighbor ids and get
/// the normalized Jaccard role score directly.
pub fn neighbor_mass_role_similarity(neighbors_a: &[u64], neighbors_b: &[u64]) -> f32 {
    let fa = NeighborMassFootprint::from_neighbors(neighbors_a);
    let fb = NeighborMassFootprint::from_neighbors(neighbors_b);
    fa.overlap(&fb)
}

/// Python: role similarity (normalized neighbor-mass Jaccard overlap, 0..1) of
/// two entities given their neighbor-id lists. Deterministic, no LLM.
#[cfg(feature = "python")]
#[pyfunction]
#[pyo3(name = "neighbor_mass_role_similarity")]
pub fn py_neighbor_mass_role_similarity(neighbors_a: Vec<u64>, neighbors_b: Vec<u64>) -> f32 {
    neighbor_mass_role_similarity(&neighbors_a, &neighbors_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_neighbor_masses_overlap_fully() {
        let a = [10u64, 20, 30, 40];
        let s = neighbor_mass_role_similarity(&a, &a);
        assert!(
            s > 0.99,
            "identical neighbor masses should overlap ~1.0, got {s}"
        );
    }

    #[test]
    fn disjoint_neighbor_masses_do_not_overlap() {
        let s = neighbor_mass_role_similarity(&[1, 2, 3], &[100, 200, 300]);
        // With a 512-bit footprint and 3 hashes/neighbor, accidental collisions
        // are rare; disjoint sets should score near zero.
        assert!(
            s < 0.2,
            "disjoint neighbor masses should be near 0, got {s}"
        );
    }

    #[test]
    fn shared_neighbors_raise_overlap_monotonically() {
        // The MORE neighbors two entities share, the higher the role overlap.
        // This is the core claim: role = overlap of external interaction mass.
        let base = [1u64, 2, 3, 4, 5, 6];
        let little = neighbor_mass_role_similarity(&base, &[1, 99, 98, 97, 96, 95]); // share 1
        let lots = neighbor_mass_role_similarity(&base, &[1, 2, 3, 4, 96, 95]); // share 4
        assert!(
            lots > little,
            "more shared neighbors must raise overlap: lots={lots} little={little}"
        );
    }

    #[test]
    fn overlap_is_symmetric() {
        let a = [5u64, 6, 7, 8];
        let b = [6u64, 7, 8, 9, 10];
        let ab = neighbor_mass_role_similarity(&a, &b);
        let ba = neighbor_mass_role_similarity(&b, &a);
        assert_eq!(ab, ba);
    }

    #[test]
    fn order_and_duplicates_do_not_matter() {
        // Role depends on the SET of neighbors, not order or multiplicity.
        let s1 = neighbor_mass_role_similarity(&[1, 2, 3], &[3, 3, 2, 1, 1]);
        assert!(
            s1 > 0.99,
            "set-equal neighbor masses must overlap ~1.0, got {s1}"
        );
    }

    #[test]
    fn empty_neighbor_mass_scores_zero() {
        assert_eq!(neighbor_mass_role_similarity(&[], &[1, 2, 3]), 0.0);
        assert_eq!(neighbor_mass_role_similarity(&[], &[]), 0.0);
    }

    #[test]
    fn disjoint_sparse_entities_score_low() {
        // While footprints are sparse, the signal comes from the FACT of shared
        // neighbors, not from how MANY neighbors an entity has: two disjoint
        // sparse entities score low.
        let a: Vec<u64> = (0..30).collect();
        let b: Vec<u64> = (1000..1030).collect();
        let fa = NeighborMassFootprint::from_neighbors(&a);
        let fb = NeighborMassFootprint::from_neighbors(&b);
        assert!(
            fa.overlap(&fb) < 0.25,
            "disjoint sparse entities must score low on overlap"
        );
    }

    #[test]
    fn bloom_is_not_degree_immune_at_high_degree() {
        // HONEST limit, not an immunity claim: the 512-bit / 3-hash footprint
        // saturates as degree grows, so two GENUINELY DISJOINT high-degree
        // entities accrue a non-trivial FALSE overlap. This documents the bound
        // (use exact-set Jaccard or a wider footprint above ~degree 50).
        let a: Vec<u64> = (0..120).collect();
        let b: Vec<u64> = (2000..2120).collect();
        let fa = NeighborMassFootprint::from_neighbors(&a);
        let fb = NeighborMassFootprint::from_neighbors(&b);
        // The footprints are nearly full…
        assert!(fa.popcount() > 250 && fb.popcount() > 250);
        // …and disjoint entities now overlap spuriously. This is EXPECTED and is
        // the reason the doc warns against high-degree use.
        assert!(
            fa.overlap(&fb) > 0.30,
            "documents the degree-saturation floor (got {})",
            fa.overlap(&fb)
        );
    }

    #[test]
    fn drug_role_overlap_via_shared_targets() {
        // The medical-agent use case: two drugs are role-similar when they act
        // on overlapping target/gene sets, even with no name/text in common.
        let drug_a_targets = [101u64, 102, 103, 104]; // e.g. COX-1/COX-2/...
        let drug_b_targets = [101u64, 102, 103, 999]; // shares 3 of 4 targets
        let drug_c_targets = [500u64, 501, 502, 503]; // unrelated targets
        let ab = neighbor_mass_role_similarity(&drug_a_targets, &drug_b_targets);
        let ac = neighbor_mass_role_similarity(&drug_a_targets, &drug_c_targets);
        assert!(
            ab > ac,
            "drug sharing targets must be more role-similar than an unrelated drug: ab={ab} ac={ac}"
        );
    }
}
