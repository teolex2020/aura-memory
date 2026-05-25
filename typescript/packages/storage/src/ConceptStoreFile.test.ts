import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { ConceptPartitionMode, ConceptSeedMode, ConceptSimilarityMode, ConceptUnionMode } from "@aura/contract"
import { ConceptStoreFile } from "./ConceptStoreFile"

it("ConceptStoreFile load/save roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-concept-store-"))
  const file = ConceptStoreFile.new(dir)

  const empty = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(empty, ConceptStoreFile.empty_engine())

  const engine = {
    version: 1,
    concepts: {},
    key_index: {},
    seed_mode: ConceptSeedMode.Standard,
    similarity_mode: ConceptSimilarityMode.SdrTanimoto,
    partition_mode: ConceptPartitionMode.Standard,
    union_mode: ConceptUnionMode.Standard
  } as const
  await Effect.runPromise(file.save(engine).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(loaded, engine)
})
