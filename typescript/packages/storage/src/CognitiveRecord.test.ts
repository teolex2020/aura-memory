import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "./CognitiveStoreFile"
import { loadCognitiveRecords } from "./CognitiveRecord"

it("loadCognitiveRecords reads brain.cog + brain.snap and normalizes record shape", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cogrec-"))

  const record: any = {
    id: "r1",
    content: "hello",
    aura_id: "a1"
  }

  const writeProgram = Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    yield* store.appendStore(record)
    yield* store.flush()
    yield* store.writeSnapshot([record])
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))

  await Effect.runPromise(writeProgram)

  const readProgram = Effect.gen(function* () {
    const records = yield* loadCognitiveRecords(dir)
    const r = records.get("r1")!
    assert.strictEqual(r.id, "r1")
    assert.strictEqual(r.content, "hello")
    assert.deepStrictEqual(r.tags, [])
    assert.strictEqual(r.aura_id, "a1")
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(readProgram)
})
