import { it } from "vitest"
import { assert } from "@effect/vitest"
import type { RecallView } from "@aura/contract"
import { rrfFuse } from "./RRF"

it("rrfFuse mirrors Rust filter_map for strength and namespace", () => {
  const records: RecallView["records"] = new Map<string, unknown>([
    ["defaulted", { id: "defaulted", strength: 0.9 }],
    ["weak", { id: "weak", strength: 0.1, namespace: "default" }],
    ["other_ns", { id: "other_ns", strength: 1, namespace: "other" }],
  ])

  const filtered = rrfFuse(
    records,
    [[["defaulted", 0.7], ["weak", 0.6], ["other_ns", 0.5], ["missing", 0.4]]],
    0.5,
    10,
    ["default"],
  )

  assert.deepStrictEqual(filtered.map(([, id]) => id), ["defaulted"])
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

it("rrfFuse treats an empty namespace list like Rust contains on an empty slice", () => {
  const records: RecallView["records"] = new Map<string, unknown>([
    ["r1", { id: "r1", strength: 1, namespace: "default" }],
  ])

  assert.deepStrictEqual(rrfFuse(records, [[["r1", 1]]], 0, 10, []), [])
})
