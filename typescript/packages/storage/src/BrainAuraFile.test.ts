import { it } from "vitest"
import { assert } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { FileRead } from "@aura/contract"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile } from "./BrainAuraFile"
import { readBrainAuraFile } from "./BrainAura"
import { deriveKeyFromPassword } from "@aura/codec"

it("write and read brain.aura records (plaintext + encrypted)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-brain-"))
  const brainAuraPath = path.join(dir, "brain.aura")

  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)

  const program = Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)

    const f1 = yield* BrainAuraFile.open(dir)
    yield* f1.append({
      id: "id_plain",
      dna: "user_core",
      timestamp: 1,
      intensity: 0.1,
      stability: 0.2,
      decay_velocity: 0.3,
      entropy: 0.4,
      sdr_indices: [1, 10, 100, 2000],
      text: "hello plaintext"
    })
    yield* f1.flush()

    const buf1 = yield* fr.readFile(brainAuraPath)
    const parsedPlain = readBrainAuraFile(buf1)
    assert.strictEqual(parsedPlain.header.count, 1n)
    assert.strictEqual(parsedPlain.records.length, 1)
    assert.strictEqual(parsedPlain.records[0]!.text, "hello plaintext")

    const f2 = yield* BrainAuraFile.open(dir, key)
    yield* f2.append({
      id: "id_enc",
      dna: "user_core",
      timestamp: 2,
      intensity: 0.1,
      stability: 0.2,
      decay_velocity: 0.3,
      entropy: 0.4,
      sdr_indices: [42],
      text: "hello encrypted",
      encrypted_flag: 1
    })
    yield* f2.flush()

    const buf2 = yield* fr.readFile(brainAuraPath)
    const parsedWithKey = readBrainAuraFile(buf2, key)
    assert.strictEqual(parsedWithKey.header.count, 2n)
    assert.strictEqual(parsedWithKey.records.length, 2)
    assert.strictEqual(parsedWithKey.records[1]!.text, "hello encrypted")

    const parsedNoKey = readBrainAuraFile(buf2)
    assert.strictEqual(parsedNoKey.records.length, 2)
    assert.strictEqual(parsedNoKey.records[1]!.text, "<encrypted - no key>")
  }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provide(NodeFileWriteLive),
    Effect.provide(NodeClockLive),
    Effect.provide(NodeCryptoLive)
  )

  await Effect.runPromise(program)

  const proc = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-verify-brain", "--", dir], {
    cwd: path.join(process.cwd(), ".."),
    encoding: "utf8"
  })
  assert.strictEqual(proc.status, 0)
  const out = JSON.parse(proc.stdout.trim())
  assert.strictEqual(out.count, 2)
  assert.strictEqual(out.plain_text, "hello plaintext")
  assert.strictEqual(out.enc_text, "hello encrypted")
})
