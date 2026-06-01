import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { Aura } from "@aura/core"
import { createAuraMcpServer } from "./server"
import { TOOL_INVENTORY, TOOL_NAMES, type ToolInventoryEntry } from "./inventory"

const runtime = {
  brainPath: "memory://inventory",
  aura: Object.create(Aura.prototype) as Aura,
  runEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, E, never>),
}

describe("Aura MCP inventory", () => {
  it("registers the full locked Phase 7 tool inventory", () => {
    const server = createAuraMcpServer(runtime)
    const registered = server.getToolListInfo().tools.map((tool) => tool.name).sort()
    expect(registered).toEqual([...TOOL_NAMES].sort())
  })

  it("keeps the canonical ledger unique and marks unsupported tools explicitly", () => {
    const inventory: ReadonlyArray<ToolInventoryEntry> = TOOL_INVENTORY
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length)
    expect(inventory.filter((entry) => entry.status === "unsupported").map((entry) => entry.name)).toEqual([])
    for (const entry of inventory) {
      expect(entry.rustReference.length).toBeGreaterThan(0)
      expect(entry.coreSurface.length).toBeGreaterThan(0)
    }
  })
})
