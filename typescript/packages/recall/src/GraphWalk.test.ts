import { describe, expect, it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { causalWalk, CAUSAL_MAX_DEPTH } from "./CausalWalk"
import { graphWalk, GRAPH_WALK_DAMPING, GRAPH_WALK_MAX_EXPANDED } from "./GraphWalk"
import type { RecallRecord, Scored } from "./Types"

function record(id: string, overrides: Partial<RecallRecord> = {}): RecallRecord {
  return {
    id,
    strength: 1,
    namespace: "alpha",
    connections: {},
    ...overrides,
  }
}

function recallView(records: ReadonlyArray<RecallRecord>): RecallView {
  return {
    records: new Map(records.map((rec) => [rec.id, rec])),
    auraIndex: new Map(),
    auraHeaders: new Map(),
    invertedIndex: { search: () => [] },
    ngramIndex: { query: () => [] },
    tagIndex: new Map(),
  }
}

function scoreFor(scored: Scored, id: string): number {
  const score = scored.find(([, rid]) => rid === id)?.[0]
  if (score === undefined) throw new Error(`missing score for ${id}`)
  return score
}

describe("graphWalk Rust parity", () => {
  it("deduplicates one-hop frontier by best score and applies strength/namespace/min-score gates", () => {
    const view = recallView([
      record("seed", {
        connections: {
          target: 0.2,
          weakEdge: 0.01,
          lowStrength: 1,
          otherNamespace: 1,
        },
      }),
      record("alt", { connections: { target: 1 } }),
      record("target"),
      record("weakEdge"),
      record("lowStrength", { strength: 0.4 }),
      record("otherNamespace", { namespace: "beta" }),
    ])

    const scored = graphWalk(view, [[1, "seed"], [0.5, "alt"]], 0.5, ["alpha"])

    assert.deepStrictEqual(scored.map(([, id]) => id), ["seed", "alt", "target"])
    expect(scoreFor(scored, "target")).toBeCloseTo(0.5 * GRAPH_WALK_DAMPING)
  })

  it("expands exactly two hops and caps added records like Rust", () => {
    const cappedConnections = Object.fromEntries(
      Array.from({ length: GRAPH_WALK_MAX_EXPANDED + 1 }, (_, index) => [
        `cap-${index.toString().padStart(2, "0")}`,
        1 - index * 0.001,
      ])
    )
    const view = recallView([
      record("seed", { connections: { mid: 1 } }),
      record("mid", { connections: { leaf: 1 } }),
      record("leaf", { connections: { tooDeep: 1 } }),
      record("tooDeep"),
      record("capSeed", { connections: cappedConnections }),
      ...Object.keys(cappedConnections).map((id) => record(id)),
    ])

    const twoHop = graphWalk(view, [[1, "seed"]], 0, ["alpha"])
    assert.deepStrictEqual(twoHop.map(([, id]) => id), ["seed", "mid", "leaf"])
    expect(scoreFor(twoHop, "leaf")).toBeCloseTo(1 * GRAPH_WALK_DAMPING * 1 * GRAPH_WALK_DAMPING)

    const capped = graphWalk(view, [[1, "capSeed"]], 0, ["alpha"])
    assert.strictEqual(capped.length, 1 + GRAPH_WALK_MAX_EXPANDED)
    assert.isFalse(capped.some(([, id]) => id === "cap-30"))
  })

  it("does not expand through an empty namespace slice, matching Rust contains semantics", () => {
    const view = recallView([
      record("seed", { connections: { target: 1 } }),
      record("target"),
    ])

    const scored = graphWalk(view, [[1, "seed"]], 0, [])
    assert.deepStrictEqual(scored.map(([, id]) => id), ["seed"])
  })
})

describe("causalWalk Rust parity", () => {
  it("follows caused_by_id chains up to the Rust maximum depth", () => {
    const view = recallView([
      record("child", { caused_by_id: "p1" }),
      record("p1", { caused_by_id: "p2" }),
      record("p2", { caused_by_id: "p3" }),
      record("p3", { caused_by_id: "p4" }),
      record("p4"),
    ])

    const scored = causalWalk(view, [[1, "child"]], 0, ["alpha"])

    assert.deepStrictEqual(scored.map(([, id]) => id), ["child", "p1", "p2", "p3"])
    assert.strictEqual(scored.length, 1 + CAUSAL_MAX_DEPTH)
    expect(scoreFor(scored, "p1")).toBeCloseTo(0.8)
    expect(scoreFor(scored, "p2")).toBeCloseTo(0.8 * 0.9)
    expect(scoreFor(scored, "p3")).toBeCloseTo(0.8 * 0.9 ** 2)
  })

  it("breaks on already matched parents, cycles, namespace misses, and weak parents", () => {
    const view = recallView([
      record("child", { caused_by_id: "already" }),
      record("already"),
      record("cycle", { caused_by_id: "cycle" }),
      record("namespaceChild", { caused_by_id: "otherNamespace" }),
      record("otherNamespace", { namespace: "beta" }),
      record("weakChild", { caused_by_id: "weakParent" }),
      record("weakParent", { strength: 0.4 }),
    ])

    const alreadyMatched = causalWalk(view, [[1, "child"], [0.5, "already"]], 0.5, ["alpha"])
    assert.deepStrictEqual(alreadyMatched.map(([, id]) => id), ["child", "already"])

    const cycle = causalWalk(view, [[1, "cycle"]], 0.5, ["alpha"])
    assert.deepStrictEqual(cycle.map(([, id]) => id), ["cycle"])

    const namespaceMiss = causalWalk(view, [[1, "namespaceChild"]], 0.5, ["alpha"])
    assert.deepStrictEqual(namespaceMiss.map(([, id]) => id), ["namespaceChild"])

    const weak = causalWalk(view, [[1, "weakChild"]], 0.5, ["alpha"])
    assert.deepStrictEqual(weak.map(([, id]) => id), ["weakChild"])
  })

  it("does not follow parents through an empty namespace slice, matching Rust contains semantics", () => {
    const view = recallView([
      record("child", { caused_by_id: "parent" }),
      record("parent"),
    ])

    const scored = causalWalk(view, [[1, "child"]], 0, [])
    assert.deepStrictEqual(scored.map(([, id]) => id), ["child"])
  })
})
