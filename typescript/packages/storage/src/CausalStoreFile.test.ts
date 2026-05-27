import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CausalStoreFile } from "./CausalStoreFile"
import type { CausalEngineState } from "@aura/contract"
import { CausalDiscoveryMode } from "@aura/contract"

it("CausalStoreFile load/save roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-causal-store-"))
  const file = CausalStoreFile.new(dir)

  const empty = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(empty, CausalStoreFile.empty_engine())

  const engine: CausalEngineState = { version: 1, patterns: {}, discovery_mode: CausalDiscoveryMode.Standard }
  await Effect.runPromise(file.save(engine).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(loaded, engine)
})

