import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { NGramIndex, tokenizeNGram, xxh3NGramHash } from "./NGramIndex"
import { SynonymRing } from "./SynonymRing"

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

  it("uses crypto-backed random coefficients without Math.random", () => {
    const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random should not be used for NGramIndex.random")
    })
    try {
      // TODO(randomness): 随机 LSH 系数可能让小样本 query 偶发漏掉 r1；2026-06-01
      // 全量测试曾失败后单跑/复跑通过，后续需确认是真实算法概率还是测试样本过脆。
      // `it.flakyTest` only wraps Effect tests, so this non-Effect test cannot use it directly.
      const idx = NGramIndex.random(8)
      idx.add("r1", "deploy staging safety checklist")
      idx.add("r2", "unrelated banana note")
      expect(idx.query("staging safety", 4).some(([, id]) => id === "r1")).toBe(true)
    } finally {
      mathRandom.mockRestore()
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

  it("expands add/query text through SynonymRing like Rust", () => {
    const ring = new SynonymRing()
    ring.addPair("fast", "quick")
    ring.addGroup(["big", "large", "huge"])

    expect(ring.contains("FAST")).toBe(true)
    expect(ring.get("big")).toEqual(new Set(["large", "huge"]))
    expect(ring.len()).toBe(5)
    expect(ring.isEmpty()).toBe(false)
    expect(ring.expand("fast car")).toBe("fast car quick")

    const idx = NGramIndex.withSeed0(ring)
    idx.add("r1", "quick sprint")
    idx.add("r2", "slow turtle")

    expect(idx.query("fast sprint", 10).map(([, id]) => id)).toContain("r1")
  })
})
