# ARCHITECTURE.md — System Design

## Design Philosophy

TypeScript 1:1 rewrite of Rust Aura core for learning/research purposes. Key architectural constraints:
1. **Disk format parity first** — TS and Rust must generate/read compatible formats
2. **Effect-TS layered DI** — No direct `node:*` imports in core/storage/codec/indexing/recall
3. **Read-model first** — Recall pipeline built on read-only views before write paths

## Layered Architecture (Effect-smol Style)

```
┌─────────────────────────────────────────┐
│  @aura/core                             │  Facade: Aura.open, recallScored, recallRecords
├─────────────────────────────────────────┤
│  @aura/recall                           │  Pipeline: signals → RRF → graph/causal → trust/recency
├─────────────────────────────────────────┤
│  @aura/storage                          │  Read models: RecallView, BrainAura, Cog snapshots
├─────────────────────────────────────────┤
│  @aura/indexing                         │  InvertedIndex, Roaring serialization
│  @aura/codec                            │  Binary/Bincode, Crypto primitives
│  @aura/utils                            │  Pure utilities: bytes, hex, crc32, time
├─────────────────────────────────────────┤
│  @aura/contract                         │  Context Tags, domain types, enums, errors
├─────────────────────────────────────────┤
│  @aura/platform-node                    │  ONLY layer importing node:*
│                                         │  FileRead, FileWrite, Clock, Crypto Live Layers
└─────────────────────────────────────────┘
```

## Core Data Flow (Recall)

```
Query String
    │
    ▼
┌─────────────────┐
│  SDRInterpreter │──→ SDR bits (semantic decoding)
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Signal Collectors                                          │
│  • collectTags     → tag inverted index                     │
│  • collectSdr      → SDR inverted index + tanimoto          │
│  • collectNgram    → n-gram similarity (simplified)         │
│  • collectEmbedding→ optional vector similarity             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│  RRF Fusion     │──→ Ranked list of record IDs
└─────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Expanders (optional)                                       │
│  • graphWalk   → connection-weighted graph traversal        │
│  • causalWalk  → caused_by_id causal chain traversal        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────┐
│  Trust/Recency  │──→ Score adjustment based on trust config │
│  Scoring        │    and record age                          │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  Optional       │──→ Bounded reranking (if service provided)│
│  BoundedReranker│                                           │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  Optional       │──→ Finalize side effects                  │
│  RecallFinalizer│    (activate/strengthen/session/audit)    │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  recallRecords  │──→ Map IDs to full record objects
│  recallScored   │──→ Return [score, id] pairs
└─────────────────┘
```

## Epistemic Runtime (Maintenance Chain)

```
Record
  │
  ▼
Belief ──→ BeliefEngine / BeliefStore
  │
  ▼
Concept ──→ ConceptEngine / ConceptStore
  │
  ▼
Causal ──→ CausalEngine / CausalStore
  │
  ▼
Policy ──→ PolicyEngine / PolicyStore
  │
  ▼
EpistemicRuntime / EpistemicTrace
```

## Key Design Patterns

### Dependency Injection via Effect Context/Layer
- Services defined as `Context.Tag` in `@aura/contract`
- Live implementations provided via `Layer.succeed` or `Layer.effect`
- Core functions declare requirements in return type: `Effect.Effect<A, E, R>`
- `DefaultLayer(brainDir)` assembles all maintenance stores into single Layer

### Error Handling
- **Tagged errors**: `Data.TaggedError("TagName")<{ ... }>`
- **No `unknown` in E channel**: Error types are explicit and enumerable
- **Defects for unimplemented**: `Effect.die(new UnimplementedError(...))` for non-main-flow placeholders

### Optional Service Pattern
- `serviceOption(Tag)` returns `Option<Shape>`
- Pipeline branches check `Option.isSome` and skip when service absent
- Both paths tested (missing and provided)

### Rust Enum Mapping
- Rust enums → TypeScript `enum` (string enum), not string unions
- Runtime values available: `Level.Working`
- Values must match Rust string representation exactly
- Validation via `Object.values(Enum).includes(x)` before casting
