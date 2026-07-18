"""Aura — Cognitive Memory for AI Agents.

Pure Rust implementation with Python bindings.
No embeddings required. No vendor lock-in.
"""

from aura._core import (
    # Main
    Aura,
    ConsequencePolarity,
    ConsequenceUnit,
    ConsequencePolicyHint,
    Level,
    Record,
    RouteStateClass,

    # Neighbor-mass role overlap (link-prediction by external interaction mass)
    NeighborMassFootprint,
    neighbor_mass_role_similarity,

    # Typed causal grammar (correlation vs counterfactual causation)
    CausalEdgeKind,
    classify_causal_edge,

    # Executable-judge world fact (close an evidence debt from a real command)
    world_fact_from_output,

    # Tag & Trust Configuration
    TagTaxonomy,
    TrustConfig,

    # Living Memory (Background Maintenance)
    MaintenanceConfig,
    MaintenanceReport,
    ArchivalRule,
    DecayReport,
    ReflectReport,
    ConsolidationReport,

    # Identity
    AgentPersona,
    PersonaTraits,

    # Circuit Breaker
    CircuitBreakerConfig,
)

from aura.events import AuraEvents

__version__ = "1.5.7"
__all__ = [
    "Aura",
    "AuraEvents",
    "ConsequencePolarity",
    "ConsequenceUnit",
    "ConsequencePolicyHint",
    "Level",
    "Record",
    "RouteStateClass",
    "NeighborMassFootprint",
    "neighbor_mass_role_similarity",
    "CausalEdgeKind",
    "classify_causal_edge",
    "world_fact_from_output",
    "TagTaxonomy",
    "TrustConfig",
    "MaintenanceConfig",
    "MaintenanceReport",
    "ArchivalRule",
    "DecayReport",
    "ReflectReport",
    "ConsolidationReport",
    "AgentPersona",
    "PersonaTraits",
    "CircuitBreakerConfig",
]
