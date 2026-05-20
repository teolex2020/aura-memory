import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive } from "@aura/platform-node"
import { InvertedIndex } from "@aura/indexing"

it("InvertedIndex loads Rust fixture", async () => {
  const dir = path.join(process.cwd(), "test/fixtures/minimal_index")
  const program = Effect.gen(function* () {
    const idx = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(idx.search([2, 3]).sort(), ["doc_a"].sort())
  }).pipe(Effect.provide(NodeFileReadLive))
  await Effect.runPromise(program)
})

