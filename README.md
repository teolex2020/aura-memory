<p align="center">
  <h1 align="center">Aura Memory</h1>
  <p align="center"><strong>Aura turns fragile prompt-only agents into auditable, memory-aware, production-ready systems</strong></p>
  <p align="center">
    Deterministic · No fine-tuning · No cloud training · Local recall · No required embeddings
  </p>
</p>

<p align="center">
  <a href="https://github.com/teolex2020/aura-memory/actions/workflows/test.yml"><img src="https://github.com/teolex2020/aura-memory/actions/workflows/test.yml/badge.svg" alt="CI"></a>
  <a href="https://pypi.org/project/aura-memory/"><img src="https://img.shields.io/pypi/v/aura-memory.svg" alt="PyPI"></a>
  <a href="https://pypi.org/project/aura-memory/"><img src="https://img.shields.io/pypi/dm/aura-memory.svg" alt="Downloads"></a>
  <a href="https://github.com/teolex2020/aura-memory/stargazers"><img src="https://img.shields.io/github/stars/teolex2020/aura-memory?style=social" alt="GitHub stars"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://www.uspto.gov/"><img src="https://img.shields.io/badge/Patent_Pending-US_63%2F969%2C703-blue.svg" alt="Patent Pending"></a>
</p>

<p align="center">
  <a href="https://colab.research.google.com/github/teolex2020/aura-memory/blob/main/examples/colab_quickstart.ipynb"><img src="https://colab.research.google.com/assets/colab-badge.svg" alt="Open In Colab"></a>&nbsp;&nbsp;
  <a href="https://www.youtube.com/watch?v=ZyE9P2_uKxg"><img src="https://img.shields.io/badge/YouTube-Demo_30s-red?logo=youtube" alt="Demo Video"></a>&nbsp;&nbsp;
  <a href="https://aurasdk.dev"><img src="https://img.shields.io/badge/Web-aurasdk.dev-blue" alt="Website"></a>
</p>

---

Your AI model is smart. But it forgets everything after every conversation.

Aura is a local cognitive runtime that runs alongside any frozen model. It gives agents durable memory, explainability, governed correction, bounded recall reranking, and bounded self-adaptation through experience — all locally, without fine-tuning or cloud training.

```bash
pip install aura-memory
```

```python
from aura import Aura, Level

brain = Aura("./agent_memory")
brain.enable_full_cognitive_stack()  # activate all four bounded reranking overlays

# store what happens
brain.store("User always deploys to staging first", level=Level.Domain, tags=["workflow"])
brain.store("Staging deploy prevented 3 production incidents", level=Level.Domain, tags=["workflow"])

# recall — local retrieval with optional bounded cognitive reranking
context = brain.recall("deployment decision")  # local retrieval, no API call

# inspect advisory hints produced from stored evidence
hints = brain.get_surfaced_policy_hints()
# → [{"action": "Prefer", "domain": "workflow", "description": "deploy to staging first"}]
```

No API keys. No embeddings required. No cloud. The model stays the same — the cognitive layer becomes more structured, more inspectable, and more useful over time.

> **⭐ If Aura is useful to you, a [GitHub star](https://github.com/teolex2020/aura-memory) helps us get funding to continue development from Kyiv.**

---

## Why Aura?

| | **Aura** | Mem0 | Zep | Cognee | Letta/MemGPT |
|---|---|---|---|---|---|
| **Architecture** | **5-layer cognitive engine** | Vector + LLM | Vector + LLM | Graph + LLM | LLM orchestration |
| **Derived cognitive layers without LLM** | **Yes — Belief→Concept→Causal→Policy** | No | No | No | No |
| **Advisory policy hints from experience** | **Yes — bounded and non-executing** | No | No | No | No |
| **Learns from agent's own responses** | **Yes — bounded, auditable, no fine-tuning** | No | No | No | No |
| **Salience weighting** | **Yes — what matters persists longer** | No | No | No | No |
| **Contradiction governance** | **Yes — explicit, operator-visible** | No | No | No | No |
| **LLM required** | **No** | Yes | Yes | Yes | Yes |
| **Recall latency** | **2.68 ms uncached / 8.2 µs formatted cache hit**<sup>1</sup> | Configuration-dependent | Service-dependent | Configuration-dependent | Model-dependent |
| **Works offline** | **Fully** | Partial | No | No | With local LLM |
| **Cost per operation** | **$0** | API billing | Credit-based | LLM + DB cost | LLM cost |
| **Package size** | **2.77 MB Windows CPython 3.13 wheel**<sup>1</sup> | Varies | Cloud service | Varies | Varies |
| **Memory decay & promotion** | **Built-in** | Via LLM | Via LLM | No | Via LLM |
| **Trust & provenance** | **Built-in** | No | No | No | No |
| **Encryption at rest** | **ChaCha20 + Argon2** | No | No | No | No |
| **Language** | **Rust** | Python | Proprietary | Python | Python |

### The Core Idea: Cheap Model + Aura > Expensive Model Alone

Fine-tuning costs thousands of dollars and weeks of work. RAG requires embeddings and a vector database. Context windows are expensive per token.

Aura gives you a third path: **a local cognitive runtime that accumulates structured experience between conversations** — free and local.

```
Week 1: GPT-4o-mini + Aura                Week 1: GPT-4 alone
  → average answers                          → average answers

Week 4: GPT-4o-mini + Aura                Week 4: GPT-4 alone
  → recalls your workflow                    → still forgets everything
  → surfaces patterns you repeat             → same cost per token
  → exposes explainability + correction      → no improvement
  → boundedly adapts from experience         → no durable learning
  → $0 compute cost                          → still billing per call
```

The model stays the same. The cognitive layer gets stronger. That's Aura.

### Performance

Measured from the Aura `1.58.0` release wheel with 1,000 records on Windows 10,
an AMD Ryzen 5 5600X, and CPython 3.13.14. These are observations from one
local run, not latency guarantees; hardware, stored content, query shape, cache
state, enabled features, and background load all affect the result.

| Operation | Mean | Median | P95 |
|-----------|-----:|-------:|----:|
| Store | 0.956 ms | 0.898 ms | 1.820 ms |
| Structured recall, uncached | 2.680 ms | 2.483 ms | 4.035 ms |
| Structured recall, cache hit | 0.101 ms | 0.097 ms | 0.163 ms |
| Formatted recall, cache hit | 8.6 µs | 8.2 µs | 8.7 µs |
| Repeated maintenance cycle | — | 25.68 ms | 32.62 ms |

The first maintenance cycle in this run took `487.09 ms` because it processed
the newly populated store; repeated cycles had less pending work. Aura recall
uses local computation and makes no required embedding or LLM API call. No
cross-product speedup is claimed here because a valid comparison requires the
same dataset, hardware, query workload, cache state, and quality target.

Reproduce the table with:

```bash
python benchmarks/bench_all.py 1000
```

The complete machine-readable output is stored in
[`benchmarks/results.json`](benchmarks/results.json).

<sub><sup>1</sup> Values above are from the measured Windows build. The wheel was
2,772,715 bytes; installed size and artifacts for other Python versions and
platforms vary.</sub>

---

## What Ships Today

Aura's full cognitive recall pipeline is active and bounded:

`Record → Belief (±5%) → Concept (±4%) → Causal (±3%) → Policy (±2%)`

Enable everything in one call:

```python
brain.enable_full_cognitive_stack()   # activates all four bounded reranking phases
brain.disable_full_cognitive_stack()  # back to raw RRF baseline
```

Or configure individual phases:

```python
brain.set_belief_rerank_mode("limited")   # belief-aware ranking
brain.set_concept_surface_mode("limited") # concept annotations + bounded concept reranking
brain.set_causal_rerank_mode("limited")   # causal chain boost
brain.set_policy_rerank_mode("limited")   # policy hint shaping
```

Higher layers also expose advisory surfaced output:

- `get_surfaced_concepts()` — stable concept abstractions over repeated beliefs
- `get_surfaced_causal_patterns()` — learned cause→effect patterns
- `get_surfaced_policy_hints()` — advisory recommendations (Prefer / Avoid / Warn)
- no automatic behavior influence — all output is advisory and read-only

Aura also ships operator-facing and plasticity-facing surfaces:

- explainability:
  - `explain_recall()`
  - `explain_record()`
  - `provenance_chain()`
  - `explainability_bundle()`
- governed correction:
  - targeted retract/deprecate APIs
  - persistent correction log
  - correction review queue
  - suggested corrections without auto-apply
- bounded autonomous plasticity:
  - `capture_experience()`
  - `ingest_experience_batch()`
  - maintenance-phase integration
  - anti-hallucination guards
  - plasticity risk scoring
  - purge / freeze controls
- bounded v6 cognitive guidance:
  - salience:
    - `mark_record_salience()`
    - `get_high_salience_records()`
    - `get_salience_summary()`
  - reflection:
    - `get_reflection_summaries()`
    - `get_latest_reflection_digest()`
    - `get_reflection_digest()`
  - contradiction and instability:
    - `get_belief_instability_summary()`
    - `get_contradiction_clusters()`
    - `get_contradiction_review_queue()`
  - honest explainability support:
    - unresolved-evidence markers in recall explanations
    - bounded answer-support phrasing for agent / UI layers

---

## How Memory Works

Aura organizes memories into 4 levels across 2 tiers. Important memories persist, trivial ones decay naturally:

```
CORE TIER (slow decay — weeks to months)
  Identity  [0.99]  Who the user is. Preferences. Personality.
  Domain    [0.95]  Learned facts. Domain knowledge.

COGNITIVE TIER (fast decay — hours to days)
  Decisions [0.90]  Choices made. Action items.
  Working   [0.80]  Current tasks. Recent context.

SEMANTIC TYPES (modulate decay & promotion)
  fact          Default knowledge record.
  decision      More persistent than a standard fact. Promotes earlier.
  preference    Long-lived user or agent preference.
  contradiction Preserved longer for conflict analysis.
  trend         Time-sensitive pattern tracked over repeated activation.
  serendipity   Cross-domain discovery record.
```

One call runs the lifecycle — decay, promotion, consolidation, and archival:

```python
report = brain.run_maintenance()  # background memory maintenance
```

---

## Key Features

### Evidence & Decision Audit Graph

Aura can preserve the complete chain from evidence to a verified outcome as a
small, deterministic read-model over the existing local store. It does not
require a graph database, an LLM, or a cloud service:

```python
source_id = brain.store("Canary telemetry is healthy", source_type="retrieved")
claim_id = brain.store("The canary is healthy", semantic_type="fact")
decision_id = brain.store(
    "Proceed with the bounded rollout",
    level=Level.Decisions,
    semantic_type="decision",
)

brain.annotate_audit_entity(source_id, "source", "observed", "deploy/source")
brain.annotate_audit_entity(claim_id, "claim", "accepted", "deploy/claim")
brain.annotate_audit_entity(decision_id, "decision", "decided", "deploy/decision")
brain.link_audit_entities("deploy/source", "deploy/claim", "supports")
brain.link_audit_entities("deploy/claim", "deploy/decision", "recalled_for")

explanation = brain.explain_decision("deploy/decision")
history = brain.audit_graph(namespace="default", valid_at=timestamp)
conflicts = brain.find_claim_conflicts("deploy/claim")
```

Directed relations cover `supports`, `refutes`, `contradicts`, `supersedes`,
`derived_from`, `recalled_for`, `used_evidence`, `used_by`, `caused`,
`produced`, and `verified_by`. Entity status is append-only and bitemporal;
historical graph reconstruction uses both recording time and business-time
validity. Conflict recommendations are advisory and never rewrite memory.

The graph is rebuilt from reserved `aura.audit.v1.*` record metadata, while
links are committed atomically with Aura's existing typed connections. Compact
JSON export is available in Rust through `AuditGraph::to_compact_json()`.

### Immutable Evidence Lineage

Aura's cognitive provenance explains how a memory was formed and used. The
evidence substrate additionally binds an extracted claim to the exact bytes of
an immutable source revision:

```rust
use aura::{admission_decision, verify_lineage, AnswerPermission, EvidenceClaim,
           SourceDocument, SourceSpan, VerificationStatus};

let bytes = b"Verified value: 42";
let document = SourceDocument::from_bytes("report", "v1", "file:///report.txt", bytes);
let span = SourceSpan::from_document(&document, bytes, 0, bytes.len())?;
let integrity = verify_lineage(&document, bytes, &span);
```

`VerificationStatus` and `AnswerPermission` are independent gates. A high
confidence score never overrides a changed source hash, a superseded claim, or
a blocked citation. New `Record` fields remain backward-compatible with older
serialized records.

Evidence-aware research reports are composed only from admitted findings.
Free-form synthesis is omitted until the synthesis itself can carry claim-level
lineage, preventing blocked source material from being reintroduced indirectly.

### Context Capsules

Agents can request a deterministic hot-context projection without maintaining a
separate wiki or mutating memory through recall activation:

```python
capsule = brain.build_context_capsule(
    purpose="continue the current institute research",
    token_budget=2000,
    namespace="ask-institute",
)
```

The bounded capsule prioritizes refutation scars, open evidence debt, active
goals, contradictions, outcomes, decisions, and durable domain/identity
records. It returns an estimated token count, omitted-record count, selection
reasons, and a stable content hash. Blocked records and superseded versions
outside their validity interval are never surfaced.

### Context-Aware Applicability

Semantic relevance does not guarantee that an old experience is safe to reuse
in the agent's current situation. Experience records can declare hard,
model-independent preconditions in metadata:

```python
experience = brain.store(
    "Refresh the expired token and retry deployment",
    level=Level.DECISIONS,
    semantic_type="decision",
    metadata={
        "applicability.require.cause": "expired_token",
        "applicability.require.environment": "ready",
    },
)

results = brain.recall_with_applicability(
    "deployment authentication recovery",
    current_state={
        "cause": ["permission_denied"],
        "environment": ["ready"],
    },
    top_k=5,
)
print(results[0]["applicability"]["decision"])
```

Every recalled record is annotated as `use`, `reject`, or `unknown`, with
matched, missing, conflicting, and mismatched fields. Aura does not filter or
rerank the results and never guesses missing state. The host agent remains in
control of whether to adapt an `unknown` memory. Existing `recall()` and
`recall_structured()` behavior is unchanged.

### Portable Store Containers

Aura can package its durable memory artifacts into one portable `.aura` file:

```python
report = brain.export_container("./snapshots/agent-memory.aura")

# For provenance-sensitive backups, keep the private key outside the Aura
# store and create a signed chain from generation one.
keys = Aura.generate_container_signing_key()
signed = brain.export_signed_container(
    "./snapshots/agent-memory-signed.aura",
    keys["private_key"],
)
auth = Aura.verify_container_authenticity(
    "./snapshots/agent-memory-signed.aura",
    trusted_public_key=keys["public_key"],
    require_all_signed=True,
)
print(auth["public_key"], auth["latest_manifest_sha256"])
Aura.update_container_authenticity_checkpoint(
    "./snapshots/agent-memory-signed.aura",
    "./trusted-state/agent-memory.checkpoint.json",
    trusted_public_key=keys["public_key"],
)
Aura.verify_container_authenticity_checkpoint(
    "./snapshots/agent-memory-signed.aura",
    "./trusted-state/agent-memory.checkpoint.json",
)
Aura.import_authenticated_container(
    "./snapshots/agent-memory-signed.aura",
    "./trusted-restore",
    trusted_public_key=keys["public_key"],
    require_all_signed=True,
)

# Later snapshots append only changed artifacts. Unchanged segments are
# referenced from the previous committed generation.
delta = brain.append_container("./snapshots/agent-memory.aura")
print(delta["generation"], delta["changed_segment_count"])

signed_delta = brain.append_signed_container(
    "./snapshots/agent-memory-signed.aura",
    keys["private_key"],
)

# Inspect retention history and garbage-collect unreachable generations.
history = Aura.list_container_generations("./snapshots/agent-memory.aura")
change = Aura.diff_container_generations(
    "./snapshots/agent-memory.aura",
    from_generation=7,
    to_generation=8,
)
Aura.import_container_generation(
    "./snapshots/agent-memory.aura",
    "./restored-generation-7",
    generation=7,
)
gc = Aura.compact_container(
    "./snapshots/agent-memory.aura",
    keep_last=10,
)
print(gc["kept_generations"], gc["reclaimed_bytes"])

policy = Aura.apply_container_retention(
    "./snapshots/agent-memory.aura",
    min_generations=2,
    max_generations=20,
    max_age_seconds=30 * 24 * 60 * 60,
    max_size_bytes=512 * 1024 * 1024,
)
print(policy["selected_keep_last"], policy["size_target_met"])

# Dry-run makes no filesystem changes.
plan = Aura.plan_container_retention(
    "./snapshots/agent-memory.aura",
    min_generations=2,
    max_generations=20,
    max_age_seconds=30 * 24 * 60 * 60,
    max_size_bytes=512 * 1024 * 1024,
)
print(plan["keep_generations"], plan["drop_generations"])

# Legal holds are persisted as append-only control generations.
Aura.hold_container_generation(
    "./snapshots/agent-memory.aura",
    generation=7,
    label="legal-case-42",
)
Aura.release_container_generation_hold(
    "./snapshots/agent-memory.aura",
    generation=7,
)

# Signed chains require signed control generations too.
Aura.hold_signed_container_generation(
    "./snapshots/agent-memory-signed.aura",
    generation=1,
    label="legal-case-42",
    signing_key=keys["private_key"],
)

# Or enforce the same policy automatically after every committed append.
managed = brain.append_container_with_retention(
    "./snapshots/agent-memory.aura",
    min_generations=2,
    max_generations=20,
    max_age_seconds=30 * 24 * 60 * 60,
    max_size_bytes=512 * 1024 * 1024,
)

# One scheduler can run per Aura instance and stops when Aura closes.
brain.start_container_retention_scheduler(
    "./snapshots/agent-memory.aura",
    interval_seconds=3600,
    min_generations=2,
    max_generations=20,
    max_age_seconds=30 * 24 * 60 * 60,
    max_size_bytes=512 * 1024 * 1024,
)

# Inspection reads only the checksummed table of contents; verification also
# decompresses every segment and checks its SHA-256 digest.
toc = Aura.inspect_container("./snapshots/agent-memory.aura")
Aura.verify_container("./snapshots/agent-memory.aura")

# Read, verify, or extract only selected logical segments.
brain_log = Aura.read_container_segment(
    "./snapshots/agent-memory.aura", "brain.cog"
)
Aura.verify_container_segments(
    "./snapshots/agent-memory.aura", ["brain.cog", "index/sdr.idx"]
)
Aura.extract_container_segments(
    "./snapshots/agent-memory.aura",
    "./diagnostic-extract",
    ["brain.cog"],
)

# Import is deliberately restore-only: the target path must not exist.
Aura.import_container("./snapshots/agent-memory.aura", "./restored-memory")
restored = Aura("./restored-memory")
```

The versioned container uses independently compressed Zstd segments, bounded
sizes, a checksummed table of contents, and per-segment SHA-256 integrity.
Version 2 stores append-only generation frames: a generation becomes visible
only after its frame header is committed, so an interrupted append falls back
to the previous valid generation. Unchanged segments retain their original
offsets, removed artifacts disappear from the latest logical TOC, and a no-op
append adds no bytes. Version 1 containers remain readable; incremental append
requires a v2 container created by the current exporter.
Compaction retains the latest `N` committed generations with their original
generation numbers, verifies every reachable segment while rebuilding, and
replaces the old file only after the compacted container passes validation.
Unreachable payloads, dropped TOCs, and incomplete trailing frames are removed.
`keep_last` must be at least one; if the container already satisfies the
retention policy, compaction is a no-op. Version 1 containers must first be
restored and exported as v2 before they can be compacted.
Retained generations can be independently inspected, SHA-256 verified, read,
diffed, or restored to a new directory. Generation diffs deterministically
separate added, removed, content-changed, and unchanged artifacts.

Automatic retention combines generation-count, wall-clock age, and estimated
compacted-size limits by selecting the most restrictive contiguous suffix.
`min_generations` is a hard floor (default `1`), and at least one maximum must
be configured. If even the minimum retained snapshot exceeds
`max_size_bytes`, compaction still preserves the floor and returns
`size_target_met=False` instead of deleting required history.
`append_container_with_retention()` commits the new generation first and then
applies the policy. If retention fails, the append remains valid and its error
is returned; a later policy run can safely retry cleanup.

Dry-run plans report exact keep/drop generation IDs, estimated compacted size,
active holds, and whether policy limits are blocked by a hold. Legal holds are
stored inside the container as append-only control generations and propagate
through later snapshots. Because generations form a contiguous chain, holding
generation `N` preserves the full suffix from `N` through the latest
generation. Manual compaction and automatic retention both honor that floor.

The optional background scheduler uses the same mutation lock as export,
append, compaction, retention, and hold operations, records its last run/error,
and can be stopped without waiting for the interval. Mutations are serialized
both between threads and between cooperating OS processes through an advisory
sidecar lock such as `agent-memory.aura.lock`. Lock acquisition times out after
30 seconds with an explicit error. The zero-content sidecar is intentionally
kept after release so that concurrent processes always address the same OS lock
object; it does not indicate that a lock is currently held. Processes that
modify `.aura` files without using Aura APIs must coordinate on the same lock.

Signed containers use Ed25519 over a canonical logical generation manifest:
generation metadata, legal holds, and each artifact's name, original size, and
SHA-256 digest. Physical segment offsets are excluded, so verified compaction
preserves existing signatures. Each signed manifest commits to the preceding
signed manifest digest. `inspect`, `verify`, and import reject invalid
signatures automatically; `verify_container_authenticity()` additionally pins
the expected public key and can require every retained generation to be signed.
An existing unsigned v2 container can start a signed epoch with a signed append,
even when no artifact changed. After that, unsigned append and unsigned hold
operations are rejected. Retention may leave the first retained signature with
a detached predecessor digest, reported as `detached_prefix=True`.

Keep signing private keys outside the Aura store and portable containers.
Signatures authenticate retained history but cannot by themselves detect
rollback to an older, otherwise valid signed container. For anti-rollback,
persist and compare `latest_manifest_sha256` in an external trusted system.
Aura's optional authenticity checkpoint automates this comparison: it pins the
signing identity plus the highest accepted generation and manifest digest,
rejects older generations and same-generation forks, and advances atomically.
Store the checkpoint outside the Aura memory directory with trusted filesystem
permissions; deleting or modifying both the container and its checkpoint is
outside this local protection model. None of this is enabled or required for
ordinary unsigned `export_container()` / `import_container()` usage.
Extraction rejects absolute paths, traversal, duplicate names, overlapping
ranges, corruption, and existing destinations. It is an additive snapshot
format, not the live storage backend. Credential files, RBAC secrets, API keys,
and encryption key material are intentionally excluded and must be managed
separately. In Rust this support is controlled by the `capsule` feature and is
included in the default `full` build.

### Temporal Memory Versioning

Context answers what an agent needs now; memory also needs to preserve which
version of a fact was valid at a particular time. Aura records business-time
validity separately from the system time at which a replacement was recorded:

```python
old_id = brain.store(
    "The refund window is 30 days",
    namespace="shop-a",
    valid_from=1_735_689_600,
)
new_id = brain.supersede(
    old_id,
    "The refund window is 14 days",
    namespace="shop-a",
    effective_at=1_751_328_000,
)

historical = brain.recall_as_of(
    "refund window",
    timestamp=1_743_811_200,
    namespace="shop-a",
)
```

Validity intervals are half-open: `valid_from <= time < valid_until`. Ordinary
recall, search, and context capsules return only records valid now; expired and
future versions remain available for audit through `get()`, `history()`,
`version_chain()`, and `recall_as_of()`. `recall_at()` retains its system-time
knowledge cutoff, while `recall_as_of()` answers the business-time question
using everything Aura knows now. Namespace isolation applies to both paths.
Supersession is committed as one durable cognitive-journal frame: the old
validity boundary, successor, and causal links either replay together or do not
apply. On startup Aura also repairs the `pending` marker written by older
releases after an interrupted replacement.

### Inspectable Memory Decisions

`explain_recall()` uses the same retrieval and bounded-reranking pipeline as
normal recall, but does not activate or mutate records. In addition to the
selected items and their existing score/provenance traces, it reports relevant
candidates rejected by memory gates:

```python
decision = brain.explain_recall(
    "refund window",
    top_k=5,
    namespace="shop-a",
)

print(decision["trace_id"])
print(decision["decision_summary"]["rejection_counts"])
for candidate in decision["rejected_candidates"]:
    print(candidate["record_id"], candidate["reasons"])
```

Current rejection reasons are `expired`, `not_yet_valid`,
`invalid_temporal_bounds`, `below_strength_threshold`, `outside_top_k`, and
`suppressed_by_belief_resolution`. For belief competition, selected and
rejected entries expose the candidate hypothesis, winning hypothesis, both
scores, and whether the record belongs to the winning side. Rejected output is
bounded and includes omission counts. Candidate discovery is performed only
inside the requested namespace scope: records belonging to another tenant are
never represented in the trace, even by ID. The generated `memory_trace_id`,
selected count, and rejected count are also attached to the existing
OpenTelemetry span without logging the query or record contents.

### Governed Promotion and Contradiction Safety

Memory level controls retention, not truth. Aura therefore uses one governed
policy for automatic reflection and promotion-candidate surfaces:

- Working records may graduate to Decisions through repeated use.
- Promotion into Domain or Identity pauses when a record is an explicit
  contradiction, carries conflict mass, or has volatility of `0.20` or more.
- Domain-to-Identity promotion additionally requires at least 20 activations
  and `0.90` strength.
- Expired and not-yet-valid versions are never promoted.

During maintenance, conflict and volatility are refreshed before promotion.
Explicit `contradicts`/`conflict` links form competing belief hypotheses rather
than collapsing both sides into one bucket. Hypothesis recency uses business
validity (`valid_from`) or creation time—not `last_activated`—so retrieving a
stale rule cannot make its evidence fresh again. When a belief is resolved,
the winning hypothesis is admitted to current recall and the losing side stays
available through history and `explain_recall()` as suppressed evidence.
Aura only resolves an explicit conflict graph as two competing sides when the
graph is one connected bipartite component. Odd cycles, multiple independent
components, isolated claims, and conflict sets without a defensible binary
topology remain `Unresolved`; no record receives a synthetic winning vote.

Use `promotion_block_reason(record_id)` to inspect why a record cannot advance.
For a genuine rule replacement, prefer `supersede(..., effective_at=...)`; use
an explicit `contradicts` relationship when both claims must remain auditable
as competing evidence.

**Core Cognitive Runtime**
- **Fast Local Recall** - Multi-signal SDR + BM25 + N-gram + tag ranking with optional embedding support
- **Two-Tier Memory** — Cognitive (ephemeral) + Core (permanent) with decay, promotion, and archival
- **Semantic Memory Types** — 6 roles (`fact`, `decision`, `trend`, `preference`, `contradiction`, `serendipity`) that influence memory behavior and insighting
- **Phase-Based Insights** — Detects conflicts, trends, preference patterns, and cross-domain links
- **Background Maintenance** — Continuous memory hygiene: decay, reflect, insights, consolidation, archival
- **Namespace Isolation** — `namespace="sandbox"` keeps test data invisible to production recall
- **Pluggable Embeddings** - Optional embedding support: bring your own embedding function

**Trust & Safety**
- **Trust & Provenance** — Source authority scoring: user input outranks web scrapes, automatically
- **Source Type Tracking** — Every memory carries provenance: `recorded`, `retrieved`, `inferred`, `generated`
- **Auto-Protect Guards** — Detects phone numbers, emails, wallets, API keys automatically
- **Encryption** — ChaCha20-Poly1305 with Argon2id key derivation

**Adaptive Memory**
- **Portable `.aura` Containers** — single-file, Zstd-compressed, SHA-256-verified store snapshots with restore-only safe import
- **Feedback Learning** — `brain.feedback(id, useful=True)` boosts useful memories, weakens noise
- **Temporal Semantic Versioning** — `brain.supersede(old_id, new_content, effective_at=...)` with validity intervals and full version chains
- **Snapshots & Rollback** — `brain.snapshot("v1")` / `brain.rollback("v1")` / `brain.diff("v1","v2")`
- **Agent-to-Agent Sharing** — `export_context()` / `import_context()` with trust metadata

**Enterprise & Integrations**
- **Multimodal Stubs** — `store_image()` / `store_audio_transcript()` with media provenance
- **Prometheus Metrics** — `/metrics` endpoint with 10+ business-level counters and histograms
- **OpenTelemetry** — `telemetry` feature flag with OTLP export and 17 instrumented spans
- **MCP Server** — Claude Desktop integration out of the box
- **WASM-Ready** — `StorageBackend` trait abstraction (`FsBackend` + `MemoryBackend`)
- **Pure Rust Core** — No Python dependencies, no external services

---

**Advisory Cognitive Overlays**
- **Belief-Aware Recall Rerank** — bounded production influence with strict guardrails
- **Concept Overlay** — surfaced concepts, per-record annotations, and optional bounded concept-aware reranking
- **Causal / Policy Overlays** — advisory surfaced output only, no automatic control path
- **Cross-Namespace Analytics** — read-only digest for tags, concepts, structural overlap, and canonical causal signatures across namespaces

**Explainability & Governed Adaptation**
- **Explainability APIs** — inspectable selected/rejected decisions through `explain_recall()`, including per-signal BM25 traces, plus `explain_record()`, `provenance_chain()`, and `explainability_bundle()`
- **Durable recall replay** — `replay_recall(trace_id)` reruns one of the latest 128 persisted traces and reports ranking additions, removals, moves, and score drift
- **Permission-aware retrieval** — per-record public/restricted ACLs with role, group, and principal allow-lists plus `audit` and deny-by-default `enforce` modes
- **Correction Governance** — correction log, correction review queue, suggested corrections, namespace governance status
- **Autonomous Cognitive Plasticity** — extraction → ingest → maintenance loop for bounded self-adaptation without changing model weights
- **Plasticity Safety Bounds** — generated-confidence ceiling, risk throttling, purge/freeze controls, operator-visible risk state

**Cognitive Guidance**
- **Salience Layer** — bounded significance weighting for preservation, reminders, ranking, and operator review
- **Maintenance Reflection** — bounded reflection summaries and digests produced inside the normal maintenance pipeline
- **Contradiction Governance** — instability summaries, contradiction clusters, and bounded operator review queues for unresolved evidence
- **Honest Answer Support** — non-anthropomorphic phrasing hints for significance, uncertainty, contradiction, and reflection context

## Quick Start

### Trust & Provenance

```python
from aura import Aura, TrustConfig

brain = Aura("./data")

tc = TrustConfig()
tc.source_trust = {"user": 1.0, "api": 0.8, "web_scrape": 0.5}
brain.set_trust_config(tc)

# User facts always rank higher than scraped data in recall
brain.store("User is vegan", channel="user")
brain.store("User might like steak restaurants", channel="web_scrape")

results = brain.recall_structured("food preferences", top_k=5)
# -> "User is vegan" scores higher, always
```

### Pluggable Embeddings (Optional)

```python
from aura import Aura

brain = Aura("./data")

# Plug in any embedding function: OpenAI, Ollama, sentence-transformers, etc.
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("all-MiniLM-L6-v2")
brain.set_embedding_fn(lambda text: model.encode(text).tolist())

# Now "login problems" matches "Authentication failed" via semantic similarity
brain.store("Authentication failed for user admin")
results = brain.recall_structured("login problems", top_k=5)
```

Without embeddings, Aura continues to use its local recall pipeline - still fast, still effective.

### Encryption

```python
brain = Aura("./secret_data", password="my-secure-password")
brain.store("Top secret information")
assert brain.is_encrypted()  # ChaCha20-Poly1305 + Argon2id
```

### Semantic Memory Types

```python
brain = Aura("./data")

# Decisions are treated as higher-value memory
brain.store("Use PostgreSQL over MySQL", semantic_type="decision", tags=["db"])

# Preferences persist longer than generic working notes
brain.store("User prefers dark mode", semantic_type="preference", tags=["ui"])

# Contradictions are preserved for conflict analysis
brain.store("User said vegan but ordered steak", semantic_type="contradiction")

# Search by semantic type
decisions = brain.search(semantic_type="decision")

# Cross-domain insights surface higher-level patterns
insights = brain.insights(phase=2)
# Example:
# [{'insight_type': 'preference_pattern', 'description': 'Preference cluster around ui', ...}]
```

### Namespace Isolation

```python
brain = Aura("./data")

brain.store("Real preference: dark mode", namespace="default")
brain.store("Test: user likes light mode", namespace="sandbox")

# Recall only sees "default" namespace — sandbox is invisible
results = brain.recall_structured("user preference", top_k=5)
```

### Cross-Namespace Digest

Use this when you need inspection-only analytics across isolated namespaces without changing recall behavior.

```python
brain = Aura("./data")

digest = brain.cross_namespace_digest(
    namespaces=["default", "sandbox"],
    top_concepts_limit=3,
)

# Top concepts per namespace
print(digest["namespaces"][0]["top_concepts"])

# Pairwise overlap
print(digest["pairs"][0]["shared_tags"])
print(digest["pairs"][0]["shared_concept_signatures"])
print(digest["pairs"][0]["shared_causal_signatures"])
```

HTTP server:

```text
GET /cross-namespace-digest?namespaces=default,sandbox&top_concepts_limit=3
```

MCP tool:

```json
{
  "tool": "cross_namespace_digest",
  "arguments": {
    "namespaces": ["default", "sandbox"],
    "top_concepts_limit": 3
  }
}
```

The digest is read-only. It does not bypass namespace isolation in recall and does not feed training or inference by default.

For richer operator-facing workflows, see [`examples/V3_OPERATOR_WORKFLOWS.md`](examples/V3_OPERATOR_WORKFLOWS.md).

### Autonomous Cognitive Plasticity

Aura can also observe model output and feed bounded experience back into the cognitive substrate, without retraining the model.

```python
from aura import Aura

brain = Aura("./data")
brain.set_plasticity_mode("limited")

capture = brain.capture_experience(
    prompt="How should we deploy this release?",
    retrieved_context=[],
    model_response="Deploy to staging first, then verify health checks before production.",
    session_id="deploy-session-1",
    source="model_inference",
)

brain.ingest_experience_batch([capture])
brain.run_maintenance()  # queued experience enters the normal cognitive pipeline
```

This stays bounded and operator-visible:

- the model remains frozen
- generated claims stay capped and guarded
- adaptation can be inspected, restricted, purged, or frozen per namespace

Recent operator HTTP endpoints:

- `GET /explain-record`
- `GET /explain-recall`
- `GET /explainability-bundle`
- `GET /correction-log`
- `GET /cross-namespace-digest`
- `GET /memory-health`
- `GET /belief-instability`
- `GET /policy-lifecycle`
- `GET /correction-review-queue`
- `GET /suggested-corrections`
- `GET /namespace-governance-status`

---

## Cookbook: Personal Assistant That Remembers

The killer use case: an agent that remembers your preferences after a week offline, with zero API calls.

See [`examples/personal_assistant.py`](examples/personal_assistant.py) for the full runnable script.

```python
from aura import Aura, Level

brain = Aura("./assistant_memory")

# Day 1: User tells the agent about themselves
brain.store("User is vegan", level=Level.Identity, tags=["diet"])
brain.store("User loves jazz music", level=Level.Identity, tags=["music"])
brain.store("User works 10am-6pm", level=Level.Identity, tags=["schedule"])
brain.store("Discuss quarterly report tomorrow", level=Level.Working, tags=["task"])

# Simulate a week passing — run maintenance cycles
for _ in range(7):
    brain.run_maintenance()  # decay + reflect + consolidate + archive

# Day 8: What does the agent remember?
context = brain.recall("user preferences and personality")
# -> Still remembers: vegan, jazz, schedule (Identity, strength ~0.93)
# -> "quarterly report" decayed heavily (Working, strength ~0.21)
```

Identity persists. Tasks fade. Important patterns get promoted. Like a real brain.

---

## MCP Server — Claude Desktop · Cursor · Zed · VS Code

Give any MCP-compatible AI persistent, self-organizing memory:

```bash
pip install aura-memory
```

**Claude Desktop** — Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "aura": {
      "command": "python",
      "args": ["-m", "aura", "mcp", "C:\\Users\\YOUR_NAME\\aura_brain"]
    }
  }
}
```

**Cursor / VS Code** — `.cursor/mcp.json` or `.vscode/mcp.json`:

```json
{
  "servers": {
    "aura": {
      "command": "python",
      "args": ["-m", "aura", "mcp", "./aura_brain"],
      "type": "stdio"
    }
  }
}
```

**macOS / Linux path:**
```bash
python -m aura mcp ~/aura_brain
```

Once connected, Claude automatically has 11 tools:

| Tool | Purpose |
|------|---------|
| `recall` | Retrieve relevant memories before answering |
| `recall_structured` | Get memories with scores and metadata |
| `store` | Save a fact, note, or context |
| `store_code` | Save a code snippet at Domain level |
| `store_decision` | Save a decision with reasoning |
| `search` | Filter memories by level or tags |
| `insights` | Memory health stats |
| `consolidate` | Merge similar records |
| `get` | Fetch a specific record by ID |
| `delete` | Remove a record by ID |
| `maintain` | Run a full maintenance cycle |

> After connecting, tell Claude: *"Before answering, always recall relevant context from memory. After our conversation, store key facts."*

### Windows test note

If `cargo test` intermittently fails on Windows with `LNK1104` for `target\debug\deps\aura-...exe`, a stale test process is usually holding the file open. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup_windows_test_lock.ps1
```

Then rerun the test command.

---

## Dashboard UI

Aura includes a standalone web dashboard for visual memory management. Download from [GitHub Releases](https://github.com/teolex2020/aura-memory/releases).

```bash
./aura-dashboard ./my_brain --port 8000
```

**Features:** Analytics · Memory Explorer with filtering · Recall Console with live scoring · Batch ingest

| Platform | Binary |
|----------|--------|
| Windows x64 | `aura-dashboard-windows-x64.exe` |
| Linux x64 | `aura-dashboard-linux-x64` |
| macOS ARM | `aura-dashboard-macos-arm64` |
| macOS x64 | `aura-dashboard-macos-x64` |

---

## Integrations & Examples

**Try now:** [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/teolex2020/aura-memory/blob/main/examples/colab_quickstart.ipynb) — zero install, runs in browser

| Integration | Description | Link |
|-------------|-------------|------|
| Ollama | Fully local AI assistant, no API key needed | [`ollama_agent.py`](examples/ollama_agent.py) |
| LangChain | Drop-in Memory class + prompt injection | [`langchain_agent.py`](examples/langchain_agent.py) |
| LlamaIndex | Chat engine with persistent memory recall | [`llamaindex_agent.py`](examples/llamaindex_agent.py) |
| OpenAI Agents | Dynamic instructions with persistent memory | [`openai_agents.py`](examples/openai_agents.py) |
| Claude SDK | System prompt injection + tool use patterns | [`claude_sdk_agent.py`](examples/claude_sdk_agent.py) |
| CrewAI | Tool-based recall/store for crew agents | [`crewai_agent.py`](examples/crewai_agent.py) |
| AutoGen | Memory protocol implementation | [`autogen_agent.py`](examples/autogen_agent.py) |
| FastAPI | Per-user memory middleware with namespace isolation | [`fastapi_middleware.py`](examples/fastapi_middleware.py) |

**FFI (C/Go/C#):** [`aura.h`](examples/aura.h) · [`go/main.go`](examples/go/main.go) · [`csharp/Program.cs`](examples/csharp/Program.cs)

**More examples:** [`basic_usage.py`](examples/basic_usage.py) · [`encryption.py`](examples/encryption.py) · [`agent_memory.py`](examples/agent_memory.py) · [`edge_device.py`](examples/edge_device.py) · [`maintenance_daemon.py`](examples/maintenance_daemon.py) · [`research_bot.py`](examples/research_bot.py)

---

## Architecture

Aura uses a Rust core with Python bindings and a local-first memory runtime.

Publicly documented concepts are:

- Two-tier memory: cognitive + core
- Semantic roles for records
- Local multi-signal recall
- Belief-aware bounded reranking
- Trust, provenance, and namespace isolation
- Maintenance, insights, consolidation, and versioning

Higher cognitive layers may be present in the SDK as bounded reranking overlays and advisory inspection surfaces. They are not default runtime decision-making or behavior control.

The public repository documents the user-facing behavior and integration surface. Detailed internal architecture, tuning, and research notes are intentionally not published.

---

## Resources

- [Demo Video (30s)](https://www.youtube.com/watch?v=ZyE9P2_uKxg) — Quick overview
- [Examples](examples/) — Ready-to-run scripts
- [Landing Page](https://aurasdk.dev) — Project overview

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines, or check the [open issues](https://github.com/teolex2020/aura-memory/issues).

⭐ **If Aura saves you time, a [GitHub star](https://github.com/teolex2020/aura-memory) helps others discover it and helps us continue development.**

---

## License & Intellectual Property

- **Code License:** MIT — see [LICENSE](LICENSE).
- **Patent Notice:** Core architectural concepts are **Patent Pending** (US Provisional Application No. **63/969,703**). See [PATENT](PATENT) for details. The SDK source code is available under MIT. Separate commercial licensing is available for organizations that want contractual rights around patented architecture, OEM embedding, enterprise deployment, or dedicated support.
- **Commercial Licensing:** If you want to embed Aura's architecture into a commercial product, see [COMMERCIAL.md](COMMERCIAL.md).

---

<p align="center">
  Built in Kyiv, Ukraine 🇺🇦 — including during power outages.<br>
  <sub>Solo developer project. If you find this useful, your star means more than you think.</sub>
</p>


