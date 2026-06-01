import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { InvertedIndex } from "@aura/indexing"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

it("InvertedIndex save/load roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-index-"))
  const program = Effect.gen(function* () {
    const idx = InvertedIndex.empty()
    idx.add("r1", [1, 2, 3])
    idx.add("r2", [2, 3])
    yield* idx.save(dir)
    const loaded = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(loaded.search([2, 3]).sort(), ["r1", "r2"].sort())
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "index_manifest.json"), "utf8")) as {
      next_doc_id: number
      id_map: Record<string, number>
    }
    assert.strictEqual(manifest.next_doc_id, 2)
    assert.strictEqual(manifest.id_map.r1, 0)
    assert.strictEqual(manifest.id_map.r2, 1)
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  await Effect.runPromise(program)
})

it("InvertedIndex remove deletes id maps and all bitmap memberships", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-index-remove-"))
  const program = Effect.gen(function* () {
    const idx = InvertedIndex.empty()
    idx.add("r1", [1, 2, 3])
    idx.add("r2", [2, 3])
    assert.strictEqual(idx.remove("missing"), false)
    assert.strictEqual(idx.remove("r1"), true)
    yield* idx.save(dir)

    const loaded = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(loaded.search([2, 3]), ["r2"])
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "index_manifest.json"), "utf8")) as {
      id_map: Record<string, number>
    }
    assert.strictEqual(manifest.id_map.r1, undefined)
    assert.strictEqual(manifest.id_map.r2, 1)
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  await Effect.runPromise(program)
})
