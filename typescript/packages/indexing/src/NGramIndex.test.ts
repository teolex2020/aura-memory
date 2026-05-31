import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { NGramIndex, tokenizeNGram, xxh3NGramHash } from "./NGramIndex"

type RustNGramVerifier = {
  readonly hashes: ReadonlyArray<readonly [string, number]>
  readonly records: ReadonlyArray<readonly [string, string]>
  readonly query_text: string
  readonly query: ReadonlyArray<readonly [number, string]>
  readonly jaccard: ReadonlyArray<readonly [string, string, number]>
}

let rustVerifierCache: RustNGramVerifier | undefined

function rustVerifier(): RustNGramVerifier {
  if (rustVerifierCache) return rustVerifierCache
  const repoRoot = path.join(process.cwd(), "..")
  const result = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-verify-ngram"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  expect(result.status, result.stderr).toBe(0)
  rustVerifierCache = JSON.parse(result.stdout.trim()) as RustNGramVerifier
  return rustVerifierCache
}

describe("NGramIndex Rust parity", () => {
  it("matches Rust verifier for xxh3_64 masked short hashes", () => {
    const rust = rustVerifier()
    const hashes = new Map(rust.hashes)
    const te = new TextEncoder()

    for (const [sample, expected] of hashes) {
      expect(xxh3NGramHash(te.encode(sample))).toBe(expected)
    }
  })

  it("tokenizes like Rust over normalized UTF-8 byte trigrams", () => {
    expect(tokenizeNGram("abc")).toEqual([154089808])
    expect(tokenizeNGram("Hello")).toEqual([469643242, 676509917, 1735597209])
    expect(tokenizeNGram("a,  b")).toEqual([609758284])
    expect(tokenizeNGram("")).toEqual([])
  })

  it("queries with MinHash + LSH and deterministic seed-0 coefficients", () => {
    const rust = rustVerifier()
    const idx = NGramIndex.withSeed0()
    for (const [id, content] of rust.records) {
      idx.add(id, content)
    }

    expect(idx.query(rust.query_text, 10)).toEqual(rust.query)
    for (const [left, right, expected] of rust.jaccard) {
      expect(idx.jaccard(left, right)).toBe(expected)
    }
  })

  it("computes signature Jaccard, remove, contains, and similar pairs", () => {
    const idx = NGramIndex.withSeed0()
    idx.add("a", "hello world foo bar")
    idx.add("b", "hello world foo bar")
    idx.add("c", "completely different text here")

    expect(idx.len()).toBe(3)
    expect(idx.isEmpty()).toBe(false)
    expect(idx.contains("a")).toBe(true)
    expect(idx.jaccard("a", "b")).toBeCloseTo(1)
    expect(idx.jaccard("a", "c")).toBeLessThan(idx.jaccard("a", "b"))
    expect(idx.findSimilarPairs(0.85).some(([left, right]) => left === "a" && right === "b")).toBe(true)

    idx.remove("a")
    expect(idx.contains("a")).toBe(false)
    expect(idx.len()).toBe(2)
  })
})
