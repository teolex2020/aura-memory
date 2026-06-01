import * as path from "node:path"
import { createRequire } from "node:module"
import { defineConfig } from "vitest/config"

const root = __dirname
const require = createRequire(import.meta.url)
const nodeCrypto = require("node:crypto") as typeof import("node:crypto")

if (typeof nodeCrypto.getRandomValues !== "function") {
  const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    nodeCrypto.randomFillSync(array as unknown as NodeJS.ArrayBufferView)
    return array
  }
  Object.defineProperty(nodeCrypto, "getRandomValues", { value: getRandomValues })
}

function pkg(name: string): string {
  return path.resolve(root, "packages", name, "src", "index.ts")
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"]
  },
  resolve: {
    alias: {
      "@aura/codec": pkg("codec"),
      "@aura/storage": pkg("storage"),
      "@aura/concept": pkg("concept"),
      "@aura/belief": pkg("belief"),
      "@aura/policy": pkg("policy"),
      "@aura/causal": pkg("causal"),
      "@aura/epistemic-runtime": pkg("epistemic-runtime"),
      "@aura/core": pkg("core"),
      "@aura/contract": pkg("contract"),
      "@aura/utils": pkg("utils"),
      "@aura/platform-node": pkg("platform-node"),
      "@aura/indexing": pkg("indexing"),
      "@aura/recall": pkg("recall")
    }
  }
})
