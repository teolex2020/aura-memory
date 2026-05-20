import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "./CognitiveStoreFile"
import { buildRecallView } from "./RecallView"

it("buildRecallView builds contract-compatible view from brain.cog+snap, brain.aura, index/", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recallview-"))
  const indexDir = path.join(dir, "index")
  fs.mkdirSync(indexDir, { recursive: true })

  const brainAuraFixture = path.join(process.cwd(), "test/fixtures/minimal_brain/brain.aura")
  fs.copyFileSync(brainAuraFixture, path.join(dir, "brain.aura"))

  const idxFixtureDir = path.join(process.cwd(), "test/fixtures/minimal_index")
  fs.copyFileSync(path.join(idxFixtureDir, "index_manifest.json"), path.join(indexDir, "index_manifest.json"))
  fs.copyFileSync(path.join(idxFixtureDir, "sdr.idx"), path.join(indexDir, "sdr.idx"))

  const recordsToWrite: any[] = [
    { id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" },
    { id: "cog_2", content: "hello index", tags: ["index"], aura_id: "doc_a" }
  ]

  const writeProgram = Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    for (const r of recordsToWrite) {
      yield* store.appendStore(r)
    }
    yield* store.flush()
    yield* store.writeSnapshot(recordsToWrite)
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))

  await Effect.runPromise(writeProgram)

  const readProgram = Effect.gen(function* () {
    const view = yield* buildRecallView(dir)

    assert.strictEqual(view.records.get("cog_1")!.content, "Hello TS Fixture")
    assert.strictEqual(view.auraIndex.get("ts_fixture_1"), "cog_1")
    assert.deepStrictEqual(view.auraHeaders.get("ts_fixture_1")!.sdr_indices, [1, 10, 100, 2000])
    assert.deepStrictEqual(Array.from(view.tagIndex.get("ts") ?? []).sort(), ["cog_1"].sort())

    const sdrHits = view.invertedIndex.search([2, 3], 10, 1)
    assert.strictEqual(sdrHits[0]![0], "doc_a")
    assert.ok(sdrHits[0]![1] >= 1)

    const ngramHits = view.ngramIndex.query("hello ts fixture", 5)
    assert.strictEqual(ngramHits[0]![1], "cog_1")
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(readProgram)
})
