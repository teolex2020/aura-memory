import { describe, expect, it } from "vitest"
import { xxh3_64, xxh3_64Hex } from "./Xxh3"

const te = new TextEncoder()

describe("xxh3_64", () => {
  it("matches xxhash_rust::xxh3::xxh3_64 golden vectors", () => {
    const vectors: ReadonlyArray<readonly [string, string | Uint8Array, string]> = [
      ["empty", "", "2d06800538d394c2"],
      ["a", "a", "e6c632b61e964e1f"],
      ["ab", "ab", "a873719c24d5735c"],
      ["abc", "abc", "78af5f94892f3950"],
      ["abcd", "abcd", "6497a96f53a89890"],
      ["hello", "hello", "9555e8555c62dcfd"],
      ["17", "1234567890abcdefg", "321e00bb2aef155e"],
      ["128", Uint8Array.from({ length: 128 }, (_, i) => i), "85c6174c7ff4c46b"],
      ["129", Uint8Array.from({ length: 129 }, (_, i) => i), "ec7642b431ba3e5a"],
      ["240", Uint8Array.from({ length: 240 }, (_, i) => i), "375a384d957fe865"],
      ["241", Uint8Array.from({ length: 241 }, (_, i) => i), "02e8cd95421c6d02"],
      ["concept-key", "default:deploy,safety:fact:rollback,staging:89abcdef", "1260c03ecd073e73"],
      ["utf8", te.encode("部署 staging 安全 checklist"), "03daee02ceccbd0c"]
    ]

    for (const [, input, expected] of vectors) {
      expect(xxh3_64Hex(input)).toBe(expected)
      expect(xxh3_64(input).toString(16).padStart(16, "0")).toBe(expected)
    }
  })
})
