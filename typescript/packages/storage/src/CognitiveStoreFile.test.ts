import { it } from "vitest"
import { assert } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "./CognitiveStoreFile"

it("write brain.cog + brain.snap and verify with Rust", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cog-"))

  const record = {
    id: "cog_fixture_1",
    content: "hello cognitive",
    level: "Working",
    strength: 1.0,
    activation_count: 0,
    created_at: 123.0,
    last_activated: 123.0,
    tags: [],
    connections: {},
    content_type: "text",
    metadata: {}
  }

  const program = Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    yield* store.appendStore(record)
    yield* store.flush()
    yield* store.writeSnapshot([record])
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))

  await Effect.runPromise(program)

  const proc = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-verify-cognitive", "--", dir], {
    cwd: path.join(process.cwd(), ".."),
    encoding: "utf8"
  })
  assert.strictEqual(proc.status, 0)
  const out = JSON.parse(proc.stdout.trim())
  assert.strictEqual(out.count, 1)
  assert.deepStrictEqual(out.ids, ["cog_fixture_1"])
  assert.strictEqual(out.first_content, "hello cognitive")
})

