import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

it("load returns empty when file missing or empty", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cog-json-"))
  const filePath = path.join(dir, "beliefs.cog")

  const empty = { ok: true }

  const missing = await Effect.runPromise(
    CogJsonSnapshotFile.load(filePath, () => empty).pipe(Effect.provide(NodeFileReadLive))
  )
  assert.deepStrictEqual(missing, empty)

  fs.writeFileSync(filePath, new Uint8Array())

  const emptyFile = await Effect.runPromise(
    CogJsonSnapshotFile.load(filePath, () => empty).pipe(Effect.provide(NodeFileReadLive))
  )
  assert.deepStrictEqual(emptyFile, empty)
})

it("save writes compact JSON and load reads it back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cog-json-"))
  const filePath = path.join(dir, "concepts.cog")

  const engine = { v: 1, nested: { x: ["a", "b"] } }

  await Effect.runPromise(
    CogJsonSnapshotFile.save(filePath, engine).pipe(Effect.provide(NodeFileWriteLive))
  )

  const loaded = await Effect.runPromise(
    CogJsonSnapshotFile.load(filePath, () => ({ v: 0 })).pipe(Effect.provide(NodeFileReadLive))
  )
  assert.deepStrictEqual(loaded, engine)
})

it("load fails with JsonParseError on invalid json", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cog-json-"))
  const filePath = path.join(dir, "causal.cog")
  fs.writeFileSync(filePath, Buffer.from("{not-json", "utf8"))

  const out = await Effect.runPromise(
    CogJsonSnapshotFile.load(filePath, () => ({})).pipe(
      Effect.map((right) => ({ _tag: "Right", right }) as const),
      Effect.catch((left) => Effect.succeed({ _tag: "Left", left } as const)),
      Effect.provide(NodeFileReadLive)
    )
  )
  assert.strictEqual(out._tag, "Left")
  if (out._tag !== "Left") return
  assert.strictEqual(out.left._tag, "JsonParseError")
})
