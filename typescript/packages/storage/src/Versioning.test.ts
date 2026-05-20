import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { VersionManager } from "@aura/storage"

it("VersionManager open/save index", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-versions-"))

  const program = Effect.gen(function* () {
    const vm = yield* VersionManager.open(dir)
    const idx = vm.getIndex()
    assert.strictEqual(idx.current_branch, "main")
    yield* vm.saveIndex()

    const vm2 = yield* VersionManager.open(dir)
    assert.strictEqual(vm2.getIndex().current_branch, "main")
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))

  await Effect.runPromise(program)
})

