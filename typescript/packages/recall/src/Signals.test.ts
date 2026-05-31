import { it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { collectSdr, collectTags } from "./Signals"
import { SDRInterpreter } from "./SDRInterpreter"

it("collectSdr matches Rust: overlap selects candidates but final ranking uses Tanimoto", async () => {
  const sdr = await SDRInterpreter.default()
  const query = "alpha overlap parity"
  const queryBits = sdr.textToSdr(query, false)
  assert.isTrue(queryBits.length > 1)

  const weakBits = queryBits.slice(0, 1)
  const records = new Map<string, unknown>([
    ["strong", { id: "strong", namespace: "default", strength: 1 }],
    ["weak", { id: "weak", namespace: "default", strength: 1 }],
  ])

  const view: RecallView = {
    records,
    auraIndex: new Map([
      ["aura-strong", "strong"],
      ["aura-weak", "weak"],
    ]),
    auraHeaders: new Map([
      ["aura-strong", { sdr_indices: queryBits }],
      ["aura-weak", { sdr_indices: weakBits }],
    ]),
    invertedIndex: {
      search: (bits, topK, minOverlap) => {
        assert.deepStrictEqual(bits, queryBits)
        assert.strictEqual(topK, 4)
        assert.strictEqual(minOverlap, 1)
        return [
          ["aura-weak", 99],
          ["aura-strong", 1],
        ]
      },
    },
    ngramIndex: { query: () => [] },
    tagIndex: new Map(),
  }

  const ranked = collectSdr(view, sdr, query, 2, ["default"])
  assert.deepStrictEqual(ranked.map(([id]) => id), ["strong", "weak"])
  assert.strictEqual(ranked[0]![1], 1)
  assert.isTrue(ranked[1]![1] < ranked[0]![1])
})

it("collectTags matches Rust Jaccard scoring and empty namespace semantics", () => {
  const records = new Map<string, unknown>([
    ["r1", { id: "r1", namespace: "default", tags: ["alpha", "beta", "extra"] }],
    ["r2", { id: "r2", namespace: "other", tags: ["alpha"] }],
  ])
  const view: RecallView = {
    records,
    auraIndex: new Map(),
    auraHeaders: new Map(),
    invertedIndex: { search: () => [] },
    ngramIndex: { query: () => [] },
    tagIndex: new Map([
      ["alpha", new Set(["r1", "r2"])],
      ["beta", new Set(["r1"])],
    ]),
  }

  const ranked = collectTags(view, "alpha beta", 10, ["default"])
  assert.deepStrictEqual(ranked, [["r1", 2 / 3]])
  assert.deepStrictEqual(collectTags(view, "alpha beta", 10, []), [])
})
