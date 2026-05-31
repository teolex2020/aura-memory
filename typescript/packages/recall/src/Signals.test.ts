import { it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { collectSdr } from "./Signals"
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

  const ranked = collectSdr(view, sdr, query, 2, [])
  assert.deepStrictEqual(ranked.map(([id]) => id), ["strong", "weak"])
  assert.strictEqual(ranked[0]![1], 1)
  assert.isTrue(ranked[1]![1] < ranked[0]![1])
})
