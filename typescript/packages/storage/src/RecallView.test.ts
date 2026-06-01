import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "./CognitiveStoreFile"
import { BrainAuraFile } from "./BrainAuraFile"
import { buildRecallView } from "./RecallView"

it("buildRecallView builds contract-compatible view from brain.cog+snap, brain.aura, index/", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recallview-"))
  const indexDir = path.join(dir, "index")
  fs.mkdirSync(indexDir, { recursive: true })

  const idxFixtureDir = path.join(process.cwd(), "test/fixtures/minimal_index")
  fs.copyFileSync(path.join(idxFixtureDir, "index_manifest.json"), path.join(indexDir, "index_manifest.json"))
  fs.copyFileSync(path.join(idxFixtureDir, "sdr.idx"), path.join(indexDir, "sdr.idx"))

  const recordsToWrite: ReadonlyArray<Record<string, unknown>> = [
    { id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" },
    { id: "cog_2", content: "hello index", tags: ["index", "CaseTag"], aura_id: "doc_a" }
  ]

  const writeProgram = Effect.gen(function* () {
    const aura = yield* BrainAuraFile.open(dir)
    yield* aura.append({
      id: "ts_fixture_1",
      dna: "user_core",
      timestamp: 1,
      intensity: 0.1,
      stability: 0.2,
      decay_velocity: 0.3,
      entropy: 0.4,
      sdr_indices: [1, 10, 100, 2000],
      text: "Hello TS Fixture"
    })
    yield* aura.flush()

    const store = yield* CognitiveStoreFile.open(dir)
    for (const r of recordsToWrite) {
      yield* store.appendStore(r)
    }
    yield* store.flush()
    yield* store.writeSnapshot(recordsToWrite)
  }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provide(NodeFileWriteLive),
    Effect.provide(NodeClockLive),
    Effect.provide(NodeCryptoLive)
  )

  await Effect.runPromise(writeProgram)

  const readProgram = Effect.gen(function* () {
    const view = yield* buildRecallView(dir)

    const r1 = view.records.get("cog_1")
    assert.ok(r1 && typeof r1 === "object")
    assert.strictEqual((r1 as Record<string, unknown>).content, "Hello TS Fixture")
    assert.strictEqual(view.auraIndex.get("ts_fixture_1"), "cog_1")
    assert.deepStrictEqual(view.auraHeaders.get("ts_fixture_1")!.sdr_indices, [1, 10, 100, 2000])
    assert.deepStrictEqual(Array.from(view.tagIndex.get("ts") ?? []).sort(), ["cog_1"].sort())
    assert.deepStrictEqual(Array.from(view.tagIndex.get("CaseTag") ?? []).sort(), ["cog_2"].sort())
    assert.isUndefined(view.tagIndex.get("casetag"))

    const sdrHits = view.invertedIndex.search([2, 3], 10, 1)
    assert.strictEqual(sdrHits[0]![0], "doc_a")
    assert.ok(sdrHits[0]![1] >= 1)

    const ngramHits = view.ngramIndex.query("hello ts fixture", 5)
    assert.strictEqual(ngramHits[0]![1], "cog_1")
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(readProgram)
})
