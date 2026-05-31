#!/usr/bin/env bun
import { startStdio } from "./server"

startStdio().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Aura MCP startup failed: ${message}`)
  process.exit(1)
})

