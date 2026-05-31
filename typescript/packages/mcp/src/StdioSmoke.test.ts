import { describe, expect, it } from "vitest"
import { MCPClient } from "@mastra/mcp"
import { Effect } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { BrainAuraFile } from "@aura/storage"
import {
  NodeClockLive,
  NodeCryptoLive,
  NodeFileReadLive,
  NodeFileWriteLive,
} from "@aura/platform-node"
import { TOOL_NAMES } from "./inventory"

function envWithBrain(brainPath: string): Record<string, string> {
  const env: Record<string, string> = {
    AURA_BRAIN_PATH: brainPath,
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

async function createEmptyBrain(): Promise<string> {
  const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-mcp-stdio-"))
  await Effect.runPromise(
    BrainAuraFile.open(brainPath).pipe(
      Effect.flatMap((file) => file.flush()),
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive),
    ),
  )
  return brainPath
}

describe("Aura MCP stdio smoke", () => {
  it("starts the explicit bin entry point and reports tool capabilities over stdio", async () => {
    const brainPath = await createEmptyBrain()
    const workspaceRoot = path.resolve(process.cwd(), "../..")
    const client = new MCPClient({
      id: `aura-mcp-smoke-${Date.now()}`,
      servers: {
        aura: {
          command: "bun",
          args: [path.join(workspaceRoot, "packages/mcp/src/bin.ts")],
          env: envWithBrain(brainPath),
          timeout: 10000,
        },
      },
      timeout: 10000,
    })

    try {
      const tools = await client.getTools()
      const advertised = Object.keys(tools).map((name) => name.replace(/^aura_/, "")).sort()
      expect(advertised).toEqual([...TOOL_NAMES].sort())
    } finally {
      await client.disconnect()
    }
  }, 20000)
})
