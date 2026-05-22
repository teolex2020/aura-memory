import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { FileRead } from "@aura/contract"
import { readBrainAuraFile } from "./BrainAura"
import { BrainAuraFile } from "./BrainAuraFile"

it("read brain.aura from generated fixture", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-brainaura-fixture-"))
  const brainAuraPath = path.join(dir, "brain.aura")

  const program = Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)
    const f = yield* BrainAuraFile.open(dir)
    yield* f.append({
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
    yield* f.flush()
    const buf = yield* fr.readFile(brainAuraPath)
    const parsed = readBrainAuraFile(buf)
    assert.strictEqual(parsed.header.magic, "AURA")
    assert.strictEqual(parsed.records.length, 1)
    assert.strictEqual(parsed.records[0]?.id, "ts_fixture_1")
    assert.strictEqual(parsed.records[0]?.dna, "user_core")
    assert.strictEqual(parsed.records[0]?.text, "Hello TS Fixture")
    assert.deepStrictEqual(parsed.records[0]?.sdr_indices, [1, 10, 100, 2000])
  }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provide(NodeFileWriteLive),
    Effect.provide(NodeClockLive),
    Effect.provide(NodeCryptoLive)
  )

  await Effect.runPromise(program)
})
