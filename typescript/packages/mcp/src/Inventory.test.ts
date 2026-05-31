import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { Aura } from "@aura/core"
import { createAuraMcpServer } from "./server"
import { TOOL_NAMES } from "./inventory"

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
})
