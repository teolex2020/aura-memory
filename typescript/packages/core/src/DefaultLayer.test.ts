import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect, Layer } from "effect"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BeliefStore, CausalStore, ConceptStore, EpistemicRuntime, EpistemicTrace, PolicyStore, RecallViewTag } from "@aura/contract"
import { DefaultLayer } from "./DefaultLayer"

it("DefaultLayer provides epistemic services", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-default-layer-"))

  const layer = DefaultLayer(dir).pipe(
    Layer.provide(NodeFileReadLive),
    Layer.provide(NodeFileWriteLive),
    Layer.provide(NodeClockLive),
    Layer.provide(NodeCryptoLive)
  )

  const program = Effect.gen(function* () {
    yield* Effect.service(RecallViewTag)
    yield* Effect.service(BeliefStore)
    yield* Effect.service(ConceptStore)
    yield* Effect.service(CausalStore)
    yield* Effect.service(PolicyStore)
    yield* Effect.service(EpistemicRuntime)
    yield* Effect.service(EpistemicTrace)
    return true as const
  }).pipe(Effect.provide(layer))

  const ok = await Effect.runPromise(program)
  assert.strictEqual(ok, true)
})
