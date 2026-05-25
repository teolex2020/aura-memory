import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { Clock } from "@aura/contract"
import { NodeFileReadLive } from "@aura/platform-node"
import { Aura } from "./index"

it("Rust recall verifier parity with TS Aura.recallScored (SDR+tags+ngram)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recall-parity-"))
  const repoRoot = path.join(process.cwd(), "..")

  const gen = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-recall-fixtures", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8"
  })
  assert.strictEqual(gen.status, 0, gen.stderr)

  const query = "alpha"
  const rust = spawnSync(
    "cargo",
    ["run", "--quiet", "--bin", "aura-ts-verify-recall", "--", dir, query],
    { cwd: repoRoot, encoding: "utf8" }
  )
  assert.strictEqual(rust.status, 0, rust.stderr)
  const rustIds: string[] = JSON.parse(rust.stdout.trim())

  const clock = Clock.fixed(1_700_000_000)
  const scored = await Effect.runPromise(
    Aura.recallScored(dir, query, { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provideService(Clock, clock)
    )
  )

  const tsIds = scored.map(([, id]) => id)
  assert.deepStrictEqual(tsIds, rustIds)
  assert.deepStrictEqual(tsIds, ["000000000001", "000000000002"])
})

