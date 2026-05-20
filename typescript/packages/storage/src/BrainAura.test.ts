import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { readBrainAuraFile } from "./BrainAura"

it("read brain.aura from rust fixture", () => {
  const p = path.join(process.cwd(), "test/fixtures/minimal_brain/brain.aura")
  const buf = new Uint8Array(fs.readFileSync(p))
  const parsed = readBrainAuraFile(buf)
  assert.strictEqual(parsed.header.magic, "AURA")
  assert.strictEqual(parsed.records.length, 1)
  assert.strictEqual(parsed.records[0]?.id, "ts_fixture_1")
  assert.strictEqual(parsed.records[0]?.dna, "user_core")
  assert.strictEqual(parsed.records[0]?.text, "Hello TS Fixture")
  assert.deepStrictEqual(parsed.records[0]?.sdr_indices, [1, 10, 100, 2000])
})

