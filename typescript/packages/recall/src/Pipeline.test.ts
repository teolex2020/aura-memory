import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  BeliefRerankMode,
  BeliefState,
  BoundedReranker,
  CausalRerankMode,
  Clock,
  ConceptSurfaceMode,
  EmbeddingStore,
  PolicyRerankMode,
  RecallFinalizer,
  RecallViewTag,
  TrustConfigTag,
  type BeliefEngineState,
  type RecallView
} from "@aura/contract"
import { BoundedRerankerImpl, SDRInterpreter, recallPipeline, recallPipelineWithTrace } from "@aura/recall"

async function makeView(query: string): Promise<RecallView> {
  const sdr = await SDRInterpreter.default()
  const bits = sdr.textToSdr(query, false)

  const records = new Map<string, unknown>()
  records.set("r1", {
    id: "r1",
    content: "hello alpha",
    tags: ["alpha"],
    aura_id: "a1",
    strength: 1,
    namespace: "default",
    source_type: "recorded",
    metadata: { trust_score: "0.5", source: "user-confirmed" },
    connections: { r2: 1 }
  })
  records.set("r2", {
    id: "r2",
    content: "connected",
    tags: [],
    strength: 1,
    namespace: "default",
    source_type: "recorded",
    metadata: { trust_score: "0.5", source: "user-confirmed" },
    connections: {},
    caused_by_id: "r3"
  })
  records.set("r3", {
    id: "r3",
    content: "root cause",
    tags: [],
    strength: 1,
    namespace: "default",
    source_type: "recorded",
    metadata: { trust_score: "0.5", source: "user-confirmed" },
    connections: {}
  })

  const view: RecallView = {
    records,
    auraIndex: new Map([["a1", "r1"]]),
    auraHeaders: new Map([["a1", { sdr_indices: bits }]]),
    invertedIndex: {
      search: () => [["a1", 2]]
    },
    ngramIndex: {
      query: () => []
    },
    tagIndex: new Map([["alpha", new Set(["r1"])]]),
  }

  return view
}

function setTimestamp(view: RecallView, id: string, iso: string): void {
  const raw = view.records.get(id)
  if (!raw || typeof raw !== "object") return
  const o = raw as Record<string, unknown>
  const mRaw = o.metadata
  const m =
    mRaw && typeof mRaw === "object" ? (mRaw as Record<string, unknown>) : ({} as Record<string, unknown>)
  m.timestamp = iso
  o.metadata = m
}

function fixedClock(nowUnixSec: number) {
  const iso = new Date(nowUnixSec * 1000).toISOString()
  return {
    clock: Clock.fixed(nowUnixSec),
    iso
  }
}

it("pipeline works without optional services and expands graph/causal", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)
  setTimestamp(view, "r2", iso)
  setTimestamp(view, "r3", iso)

  const program = recallPipeline(query, { topK: 10, expandConnections: true }).pipe(
    Effect.provideService(RecallViewTag, view),
    Effect.provideService(Clock, clock)
  )

  const scored = await Effect.runPromise(program)
  const ids = scored.map(([, id]) => id)
  assert.strictEqual(ids[0], "r1")
  assert.isTrue(ids.includes("r2"))
  assert.isTrue(ids.includes("r3"))
})

it("embedding is skipped when missing, used when present", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)
  setTimestamp(view, "r3", iso)

  const base = await Effect.runPromise(
    recallPipeline(query, { topK: 10, expandConnections: false }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock)
    )
  )
  assert.deepStrictEqual(base.map(([, id]) => id), ["r1"])

  const withEmb = await Effect.runPromise(
    recallPipeline(query, { topK: 10, expandConnections: false }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock),
      Effect.provideService(EmbeddingStore, {
        query: () => Effect.succeed([["r3", 1]])
      })
    )
  )
  assert.deepStrictEqual(withEmb.map(([, id]) => id), ["r1", "r3"])
})

it("truncates RRF topK before graph expansion like Rust", async () => {
  const records = new Map<string, unknown>([
    ["r1", {
      id: "r1",
      content: "first",
      tags: [],
      strength: 1,
      namespace: "default",
      source_type: "recorded",
      metadata: { trust_score: "0.5", source: "user-confirmed" },
      connections: {}
    }],
    ["r2", {
      id: "r2",
      content: "second",
      tags: [],
      strength: 1,
      namespace: "default",
      source_type: "recorded",
      metadata: { trust_score: "0.5", source: "user-confirmed" },
      connections: {}
    }],
    ["r3", {
      id: "r3",
      content: "third",
      tags: [],
      strength: 1,
      namespace: "default",
      source_type: "recorded",
      metadata: { trust_score: "0.5", source: "user-confirmed" },
      connections: { r4: 1 }
    }],
    ["r4", {
      id: "r4",
      content: "graph child",
      tags: [],
      strength: 100,
      namespace: "default",
      source_type: "recorded",
      metadata: { trust_score: "0.5", source: "user-confirmed" },
      connections: {}
    }]
  ])
  const view: RecallView = {
    records,
    auraIndex: new Map(),
    auraHeaders: new Map(),
    invertedIndex: { search: () => [] },
    ngramIndex: { query: () => [] },
    tagIndex: new Map(),
  }
  const { clock } = fixedClock(1_700_000_000)

  const scored = await Effect.runPromise(
    recallPipeline("alpha", { topK: 2, expandConnections: true }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock),
      Effect.provideService(EmbeddingStore, {
        query: () => Effect.succeed([["r1", 1], ["r2", 0.9], ["r3", 0.8]])
      })
    )
  )

  assert.deepStrictEqual(scored.map(([, id]) => id), ["r1", "r2"])
})

it("reranker is skipped when missing, used when present", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)
  setTimestamp(view, "r3", iso)

  const program = recallPipeline(query, { topK: 10, expandConnections: false }).pipe(
    Effect.provideService(RecallViewTag, view),
    Effect.provideService(Clock, clock),
    Effect.provideService(EmbeddingStore, {
      query: () => Effect.succeed([["r3", 1]])
    }),
    Effect.provideService(BoundedReranker, {
      rerank: (scored) => Effect.succeed(Array.from(scored).reverse())
    })
  )

  const scored = await Effect.runPromise(program)
  assert.deepStrictEqual(scored.map(([, id]) => id), ["r3", "r1"])
})

it("trace captures Shadow bounded rerank report without changing ranking", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)
  setTimestamp(view, "r2", iso)
  setTimestamp(view, "r3", iso)

  const reranker = new BoundedRerankerImpl(() =>
    Effect.succeed({
      beliefState: beliefState({ r3: BeliefState.Resolved }),
      modes: {
        beliefMode: BeliefRerankMode.Shadow,
        conceptMode: ConceptSurfaceMode.Off,
        causalMode: CausalRerankMode.Off,
        policyMode: PolicyRerankMode.Off,
      },
    })
  )

  const traced = await Effect.runPromise(
    recallPipelineWithTrace(query, { topK: 10, expandConnections: true }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock),
      Effect.provideService(BoundedReranker, reranker)
    )
  )

  assert.strictEqual(traced.boundedRerankReport?.modes.beliefMode, BeliefRerankMode.Shadow)
  const shadow = traced.boundedRerankReport?.shadow
  if (shadow === undefined) throw new Error("missing shadow report")
  assert.strictEqual(shadow.scores.length, traced.scored.length)
  assert.isTrue(shadow.belief_coverage > 0)
  assert.strictEqual(shadow.scores.find((score) => score.record_id === "r3")?.belief_multiplier, 1.10)
  assert.deepStrictEqual(traced.scored.map(([, id]) => id), ["r1", "r2", "r3"])
})

it("finalizer is skipped when missing, called when present", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)

  let called = 0

  const program = recallPipeline(query, { topK: 10, expandConnections: false, sessionId: "s1" }).pipe(
    Effect.provideService(RecallViewTag, view),
    Effect.provideService(Clock, clock),
    Effect.provideService(RecallFinalizer, {
      finalize: (_scored, sessionId) =>
        Effect.sync(() => {
          assert.strictEqual(sessionId, "s1")
          called += 1
        })
    })
  )

  await Effect.runPromise(program)
  assert.strictEqual(called, 1)
})

it("trust config is skipped when missing, used when present", async () => {
  const query = "alpha"
  const view = await makeView(query)
  const { clock, iso } = fixedClock(1_700_000_000)
  setTimestamp(view, "r1", iso)

  const noConfig = await Effect.runPromise(
    recallPipeline(query, { topK: 10, expandConnections: false }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock)
    )
  )

  const withConfig = await Effect.runPromise(
    recallPipeline(query, { topK: 10, expandConnections: false }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock),
      Effect.provideService(TrustConfigTag, {
        source_trust: {},
        source_authority: { "user-confirmed": 0.1 },
        recency_boost_max: 0,
        recency_half_life_days: 7
      })
    )
  )

  assert.strictEqual(noConfig[0]![1], "r1")
  assert.strictEqual(withConfig[0]![1], "r1")
  assert.isTrue(withConfig[0]![0] < noConfig[0]![0])
})

it("applies Rust recency scoring multiplier after RRF fusion", async () => {
  const query = "alpha"
  const { clock, iso } = fixedClock(1_700_000_000)
  const records = new Map<string, unknown>([
    ["low-strength", {
      id: "low-strength",
      content: "low strength",
      tags: [],
      strength: 0.05,
      namespace: "default",
      source_type: "recorded",
      metadata: { timestamp: iso, trust_score: "1", source: "user-confirmed" },
      connections: {}
    }],
    ["high-strength", {
      id: "high-strength",
      content: "high strength",
      tags: [],
      strength: 1,
      namespace: "default",
      source_type: "recorded",
      metadata: { timestamp: iso, trust_score: "1", source: "user-confirmed" },
      connections: {}
    }]
  ])
  const view: RecallView = {
    records,
    auraIndex: new Map(),
    auraHeaders: new Map(),
    invertedIndex: { search: () => [] },
    ngramIndex: { query: () => [] },
    tagIndex: new Map(),
  }

  const scored = await Effect.runPromise(
    recallPipeline(query, { topK: 2, expandConnections: false }).pipe(
      Effect.provideService(RecallViewTag, view),
      Effect.provideService(Clock, clock),
      Effect.provideService(EmbeddingStore, {
        query: () => Effect.succeed([["low-strength", 1], ["high-strength", 0.9]])
      })
    )
  )

  assert.deepStrictEqual(scored.map(([, id]) => id), ["high-strength", "low-strength"])
  assert.isTrue(scored[0]![0] > scored[1]![0])
})

function beliefState(recordStates: Record<string, BeliefState>): BeliefEngineState {
  const beliefs: Record<string, BeliefEngineState["beliefs"][string]> = {}
  const record_to_belief: Record<string, string> = {}
  for (const [recordId, state] of Object.entries(recordStates)) {
    const beliefId = `b-${recordId}`
    beliefs[beliefId] = {
      id: beliefId,
      key: beliefId,
      hypothesis_ids: [],
      winner_id: null,
      state,
      score: 1,
      confidence: 1,
      support_mass: 1,
      conflict_mass: 0,
      stability: 1,
      volatility: 0,
      last_updated: 0
    }
    record_to_belief[recordId] = beliefId
  }
  return { version: 1, beliefs, hypotheses: {}, record_to_belief, key_index: {}, record_index: record_to_belief }
}
