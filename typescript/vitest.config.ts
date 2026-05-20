import * as path from "node:path"
import { defineConfig } from "vitest/config"

const root = path.dirname(new URL(import.meta.url).pathname)

function pkg(name: string): string {
  return path.resolve(root, "packages", name, "src", "index.ts")
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node"
  },
  resolve: {
    alias: {
      "@aura/codec": pkg("codec"),
      "@aura/storage": pkg("storage"),
      "@aura/core": pkg("core"),
      "@aura/contract": pkg("contract"),
      "@aura/utils": pkg("utils"),
      "@aura/platform-node": pkg("platform-node"),
      "@aura/indexing": pkg("indexing")
    }
  }
})
