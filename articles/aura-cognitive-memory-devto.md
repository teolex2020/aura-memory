---
title: "AI Agents Don't Need a Bigger Prompt. They Need Governed Memory"
published: false
description: "What I learned building Aura Memory: a local cognitive layer for persistent, bounded, explainable agent memory."
tags: ai, opensource, rust, python
---

Most AI agents have a memory problem disguised as a prompting problem.

We keep adding conversation history to the context window, summarizing old messages, or placing documents in a vector database. These techniques are useful, but they do not answer several important questions:

- What should be remembered for hours, weeks, or months?
- What should decay when it stops being useful?
- Which source supports a stored claim?
- What happens when two memories contradict each other?
- Why was a particular memory returned?
- How do we prevent one user's memory from leaking into another user's context?

I built [Aura Memory](https://github.com/teolex2020/aura-memory) to explore a different approach: memory as a governed cognitive layer that runs beside the model.

The model can remain stateless. Aura owns persistence, retrieval, lifecycle, provenance, and bounded adaptation.

## A transcript is not a memory system

A chat transcript records what happened. A memory system decides what remains useful.

That distinction matters once an agent runs longer than a single conversation. Raw history grows without bound. Summaries lose detail. Vector search can find semantically similar text, but similarity alone does not express durability, trust, contradiction, or whether a record has been superseded.

For an agent to develop useful continuity, memory needs its own lifecycle:

```text
interaction
    ↓
store an observation, decision, outcome, or preference
    ↓
retrieve bounded context for the next task
    ↓
inspect provenance and uncertainty
    ↓
decay, promote, consolidate, correct, or archive
```

This is the role Aura is designed to fill.

## What Aura Memory is

Aura is an open-source cognitive memory runtime with a Rust core and Python bindings. Core memory operations run locally and do not require an LLM call, an embedding API, or a cloud database.

The basic interface is intentionally small:

```bash
pip install aura-memory
```

```python
from aura import Aura, Level

brain = Aura("./agent_memory")

brain.store(
    "The user always deploys to staging before production",
    level=Level.Domain,
    tags=["deployment", "preference"],
)

brain.store(
    "A staging deploy caught a migration error",
    level=Level.Decisions,
    tags=["deployment", "outcome"],
)

context = brain.recall(
    "How should I deploy this release?",
    token_budget=1200,
)

print(context)
```

The returned value is bounded context that can be inserted into a model prompt or used by an agent tool. Storage and retrieval are separate from model inference, so the same memory can be used with Claude, Gemini, OpenAI models, Ollama, CrewAI, LangChain, or an MCP client.

## Memory has different timescales

Not every record deserves permanent storage. Aura organizes records into four levels:

| Level | Typical role | Expected timescale |
|---|---|---|
| Working | Temporary task context | Hours |
| Decisions | Choices, actions, and active work | Days |
| Domain | Project knowledge and stable preferences | Weeks |
| Identity | Durable rules and identity-level facts | Months or longer |

Maintenance cycles apply decay, promotion, consolidation, and archival. Frequently useful or important records can persist; low-value working context can fade.

```python
report = brain.run_maintenance()
```

This is deliberately different from appending every message forever. Forgetting is part of the design, not an error condition.

## From records to cognitive structure

Raw records are only the first layer. Aura can build bounded cognitive overlays:

```text
Records → Beliefs → Concepts → Causal Patterns → Policy Hints
```

- **Records** preserve observations, decisions, preferences, and outcomes.
- **Beliefs** group supporting and conflicting evidence.
- **Concepts** capture recurring abstractions across stable beliefs.
- **Causal patterns** represent repeated cause-and-effect relationships.
- **Policy hints** surface advisory guidance such as “prefer staging first.”

The important word is *advisory*. A policy hint does not execute an action. Cognitive reranking is bounded, inspectable, and can be disabled. The application remains responsible for deciding what the agent is allowed to do.

```python
brain.enable_full_cognitive_stack()

hints = brain.get_surfaced_policy_hints()
```

This separation helps avoid a dangerous design pattern: allowing an automatically generated memory to silently become an instruction with unlimited authority.

## Retrieval should explain itself

When memory influences an agent answer, “the vector database returned it” is not enough of an explanation.

Aura exposes inspection surfaces such as:

```python
brain.explain_recall("deployment decision", top_k=5)
brain.explain_record(record_id)
brain.provenance_chain(record_id)
```

The goal is to make memory behavior operator-visible. Applications can inspect why a record surfaced, how it was derived, whether it conflicts with other information, and whether a correction is pending.

Aura also supports governed correction and bounded adaptation. Experiences can enter a reviewable pipeline rather than directly rewriting model weights or silently mutating high-trust knowledge.

## What changed in version 1.5.6

The `1.5.6` release focuses on a problem that becomes critical for research and production agents: a plausible claim is not the same as a verifiable claim.

### Immutable evidence lineage

Evidence lineage binds a claim to:

1. a specific source document revision;
2. the exact byte span used as evidence;
3. a content hash;
4. verification status;
5. an independent answer-permission decision.

A high confidence score cannot override a changed source hash, a superseded claim, or blocked citation admission. Evidence-aware reports only compose admitted findings, preventing blocked source material from being reintroduced indirectly through free-form synthesis.

### Deterministic context capsules

An agent often needs a stable “working set” for a task. Re-running broad recall can produce unnecessary context churn, while maintaining a second wiki creates another source of truth.

Context capsules provide a read-only, token-bounded projection over existing memory:

```python
capsule = brain.build_context_capsule(
    purpose="continue the current reliability investigation",
    token_budget=2000,
    namespace="reliability-team",
)
```

A capsule reports why each record was selected, how many records were omitted, its estimated token count, and a stable content hash. Blocked or superseded records are excluded.

### Observable empty recall

“The search completed successfully but found nothing” is an operational event, not merely an empty list.

Version `1.5.6` adds counters for total and empty recall/search outcomes across formatted recall, structured recall, tier recall, and exact search. This makes it possible to monitor empty-recall rates and distinguish missing knowledge from transport or model failures.

## One user, one isolated memory boundary

Local development is simple: one agent process can use one Aura directory.

A hosted multi-user system needs an explicit isolation strategy. The safest model is to treat each user's memory as a separate data boundary:

```python
from pathlib import Path
from aura import Aura

def brain_for(user_id: str) -> Aura:
    safe_id = validate_user_id(user_id)
    return Aura(Path("./memory") / safe_id)
```

Namespaces can provide additional logical isolation, but authentication and authorization still belong to the application. Never accept an arbitrary storage path or namespace directly from a browser request.

For a hosted TypeScript frontend, Aura should run behind a trusted backend or dedicated memory service. The frontend calls an authenticated API; the service selects the correct user-owned store. The Python package is not meant to run inside a static frontend bundle.

This deployment detail is easy to miss. A library can make local installation simple, but persistent memory still has to run somewhere and its data has to be backed up, encrypted, observed, and isolated.

## What Aura does not do

Aura is not a language model and does not generate the final answer. It does not make unverified input true. It does not replace application authorization, tool permission checks, or a backup strategy.

It is also not a hosted database-as-a-service. If you deploy it on a server, you own the runtime and storage lifecycle. That tradeoff is intentional: local control and offline operation come with operational responsibility.

Sparse Distributed Representation indexing is the default local retrieval path, while optional embeddings can be supplied when an application needs them. Performance depends on workload and hardware; the project includes benchmarks, but production systems should measure their own corpus and access patterns.

## Why build memory outside the model?

Models change. Providers change. Context-window pricing changes. Agent memory should not have to disappear every time the inference layer is replaced.

Keeping memory outside the model creates a stable boundary:

```text
Agent runtime
    ├── model: reasoning and generation
    ├── tools: actions in the world
    └── Aura: persistence, retrieval, evidence, lifecycle, correction
```

That boundary makes memory portable across models and easier to inspect independently. More importantly, it gives operators somewhere concrete to enforce retention, provenance, isolation, and correction policies.

The project is MIT licensed. You can explore the [source code and examples on GitHub](https://github.com/teolex2020/aura-memory), install the package from [PyPI](https://pypi.org/project/aura-memory/), or read the overview at [aurasdk.dev](https://aurasdk.dev/).

I am especially interested in how other developers handle three questions:

1. Where do you draw the boundary between conversation history and durable memory?
2. How do you isolate memory in multi-user agents?
3. What evidence should an agent be required to carry before using a stored claim in an answer?

---

*Disclosure: I am the author of Aura Memory. This article was prepared with AI assistance, then reviewed against the project's implementation, documentation, and `1.5.6` release notes.*
