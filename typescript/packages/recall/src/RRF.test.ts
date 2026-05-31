import { it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { filterByStrengthAndNamespace, rrfFuse } from "./RRF"

it("filterByStrengthAndNamespace mirrors Rust rrf_fuse filter_map", () => {
  const records: RecallView["records"] = new Map<string, unknown>([
    ["defaulted", { id: "defaulted", strength: 0.9 }],
    ["weak", { id: "weak", strength: 0.1, namespace: "default" }],
    ["other_ns", { id: "other_ns", strength: 1, namespace: "other" }],
  ])

  const filtered = filterByStrengthAndNamespace(
    records,
    [
      [0.7, "defaulted"],
      [0.6, "weak"],
      [0.5, "other_ns"],
      [0.4, "missing"],
    ],
    0.5,
    ["default"],
  )

  assert.deepStrictEqual(filtered, [[0.7, "defaulted"]])
})

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
