import { describe, expect, it } from "vitest"
import { MCPServer } from "@mastra/mcp"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"

describe("Mastra Bun/ESM MCP compatibility", () => {
  it("constructs a typed MCP server and exposes tool inventory synchronously", () => {
    const server = new MCPServer({
      name: "aura-compat",
      version: "0.0.0",
      tools: {
        ping: createTool({
          id: "ping",
          description: "Compatibility spike tool.",
          inputSchema: z.object({ message: z.string() }),
          execute: async ({ context }) => context.message,
        }),
      },
    })

    const names = server.getToolListInfo().tools.map((tool) => tool.name)
    expect(names).toEqual(["ping"])
  })
})

