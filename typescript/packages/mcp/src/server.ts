import { MCPServer } from "@mastra/mcp"
import type { AuraMcpRuntime } from "./runtime"
import { openAuraRuntime } from "./runtime"
import { createAuraTools } from "./tools"

export function createAuraMcpServer(runtime: AuraMcpRuntime): MCPServer {
  return new MCPServer({
    name: "aura",
    version: "0.0.0",
    description:
      "Aura is a cognitive memory layer for AI agents. Use recall before answering and store durable facts, decisions, and patterns.",
    tools: createAuraTools(runtime),
  })
}

export async function startStdio(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const runtime = await openAuraRuntime(env)
  const server = createAuraMcpServer(runtime)
  await server.startStdio()
}

