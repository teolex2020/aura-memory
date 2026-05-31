import { it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { rrfFuse } from "./RRF"

it("rrfFuse matches Rust signature filtering and topK truncation", () => {
  const records: RecallView["records"] = new Map<string, unknown>([
    ["strong", { id: "strong", strength: 1, namespace: "default" }],
    ["weak", { id: "weak", strength: 0.1, namespace: "default" }],
    ["other_ns", { id: "other_ns", strength: 1, namespace: "other" }],
    ["second", { id: "second", strength: 1, namespace: "default" }],
  ])

  const scored = rrfFuse(
    records,
    [[["strong", 1], ["weak", 0.9], ["other_ns", 0.8], ["second", 0.7]]],
    0.5,
    1,
    ["default"]
  )

  assert.deepStrictEqual(scored.map(([, id]) => id), ["strong"])
})

it("rrfFuse treats topK zero like Rust truncate(0)", () => {
  const records: RecallView["records"] = new Map<string, unknown>([
    ["r1", { id: "r1", strength: 1, namespace: "default" }],
  ])

  assert.deepStrictEqual(rrfFuse(records, [[["r1", 1]]], 0, 0, ["default"]), [])
})
