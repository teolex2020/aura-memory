import xxhash from "xxhash-wasm"

const DEFAULT_TOTAL_BITS = 262144
const DEFAULT_NUM_ACTIVE = 512
const DEFAULT_PROTECTED_RANGE: readonly [number, number] = [0, 4096]
const DEFAULT_GENERAL_RANGE: readonly [number, number] = [4096, 262144]

const MASK_64 = (1n << 64n) - 1n

function rotl64(x: bigint, r: number): bigint {
  const rr = BigInt(r & 63)
  return ((x << rr) | (x >> (64n - rr))) & MASK_64
}

function rotr64(x: bigint, r: number): bigint {
  const rr = BigInt(r & 63)
  return ((x >> rr) | (x << (64n - rr))) & MASK_64
}

function u64(x: bigint): bigint {
  return x & MASK_64
}

function isAsciiString(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false
  }
  return true
}

function toAsciiLowerByte(b: number): number {
  return b >= 0x41 && b <= 0x5a ? b + 0x20 : b
}

function isAsciiDigitByte(b: number): boolean {
  return b >= 0x30 && b <= 0x39
}

function dedupSortedU16(xs: number[]): number[] {
  if (xs.length <= 1) return xs
  let w = 1
  for (let r = 1; r < xs.length; r++) {
    if (xs[r] !== xs[w - 1]) {
      xs[w] = xs[r]!
      w += 1
    }
  }
  xs.length = w
  return xs
}

type Hasher = Readonly<{
  h64: (input: string) => bigint
  h64Raw: (input: Uint8Array) => bigint
}>

let hasherPromise: Promise<Hasher> | undefined

function getHasher(): Promise<Hasher> {
  hasherPromise ??= xxhash().then((h) => ({ h64: h.h64, h64Raw: h.h64Raw }))
  return hasherPromise
}

export class SDRInterpreter {
  private constructor(
    private readonly h64: Hasher["h64"],
    private readonly h64Raw: Hasher["h64Raw"],
    readonly totalBits: number,
    readonly numActive: number,
    readonly protectedRange: readonly [number, number],
    readonly generalRange: readonly [number, number]
  ) {}

  static async default(): Promise<SDRInterpreter> {
    const { h64, h64Raw } = await getHasher()
    return new SDRInterpreter(
      h64,
      h64Raw,
      DEFAULT_TOTAL_BITS,
      DEFAULT_NUM_ACTIVE,
      DEFAULT_PROTECTED_RANGE,
      DEFAULT_GENERAL_RANGE
    )
  }

  static async lite(): Promise<SDRInterpreter> {
    const { h64, h64Raw } = await getHasher()
    return new SDRInterpreter(h64, h64Raw, 16384, 128, [0, 1024], [1024, 16384])
  }

  static async withResolution(totalBits: number, numActive: number): Promise<SDRInterpreter> {
    const { h64, h64Raw } = await getHasher()
    const protectedSize = Math.floor(totalBits / 64)
    return new SDRInterpreter(h64, h64Raw, totalBits, numActive, [0, protectedSize], [protectedSize, totalBits])
  }

  tanimotoSparse(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
    if (a.length === 0 || b.length === 0) return 0

    let intersection = 0
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      const av = a[i]!
      const bv = b[j]!
      if (av < bv) {
        i += 1
      } else if (av > bv) {
        j += 1
      } else {
        intersection += 1
        i += 1
        j += 1
      }
    }

    const union = a.length + b.length - intersection
    return union === 0 ? 0 : intersection / union
  }

  textToSdr(text: string, isIdentity: boolean): number[] {
    return this.textToSdrInner(text, isIdentity, false)
  }

  textToSdrLowered(text: string, isIdentity: boolean): number[] {
    return this.textToSdrInner(text, isIdentity, true)
  }

  private textToSdrInner(text: string, isIdentity: boolean, preLowered: boolean): number[] {
    const bitRange = isIdentity ? this.protectedRange : this.generalRange
    const rangeSize = bitRange[1] - bitRange[0]
    const base = bitRange[0]

    const trimmed = text.trim()
    if (trimmed.length === 0) return []

    const indices: number[] = []

    // SIMPLE IMPLEMENTATION: 使用与 Rust 一致的 ASCII fast path + UTF-8 fallback，但未做额外的 SIMD/多线程优化。
    // FULL IMPLEMENTATION: 字节级对齐 Rust [sdr.rs](file:///workspace/src/sdr.rs) 的 xxh3_64 种子扰动、wrapping 行为与 u16 截断。

    if (isAsciiString(trimmed)) {
      const bytes = new Uint8Array(trimmed.length)
      for (let i = 0; i < trimmed.length; i++) bytes[i] = trimmed.charCodeAt(i) & 0xff

      const len = bytes.length
      const gramBuf = new Uint8Array(4)

      if (len >= 4) {
        for (let i = 0; i <= len - 4; i++) {
          let hasDigit = false
          for (let j = 0; j < 4; j++) {
            const b = bytes[i + j]!
            if (isAsciiDigitByte(b)) hasDigit = true
            gramBuf[j] = preLowered ? b : toAsciiLowerByte(b)
          }

          let seed = u64(this.h64Raw(gramBuf.subarray(0, 4)))
          if (hasDigit) seed = rotr64(u64(seed ^ 0x1234567812345678n), 3)

          for (let k = 0n; k < 20n; k++) {
            const s = u64(seed + k * 9999n)
            const idx = Number(s % BigInt(rangeSize))
            indices.push((base + idx) & 0xffff)
          }
        }
      }

      if (len >= 3) {
        for (let i = 0; i <= len - 3; i++) {
          let hasDigit = false
          for (let j = 0; j < 3; j++) {
            const b = bytes[i + j]!
            if (isAsciiDigitByte(b)) hasDigit = true
            gramBuf[j] = preLowered ? b : toAsciiLowerByte(b)
          }

          let seed = u64(this.h64Raw(gramBuf.subarray(0, 3)))
          if (hasDigit) seed = rotl64(u64(seed ^ 0x5f3759df5f3759dfn), 7)

          for (let k = 0n; k < 2n; k++) {
            const s = u64(seed + k * 1337n)
            const idx = Number(s % BigInt(rangeSize))
            indices.push((base + idx) & 0xffff)
          }
        }
      } else {
        const loweredBuf = new Uint8Array(4)
        for (let j = 0; j < Math.min(4, len); j++) {
          const b = bytes[j]!
          loweredBuf[j] = preLowered ? b : toAsciiLowerByte(b)
        }
        const seed = u64(this.h64Raw(loweredBuf.subarray(0, len)))
        for (let k = 0n; k < 2n; k++) {
          const s = u64(seed + k * 1337n)
          const idx = Number(s % BigInt(rangeSize))
          indices.push((base + idx) & 0xffff)
        }
      }

      if (len >= 2) {
        for (let i = 0; i <= len - 2; i++) {
          const b0 = bytes[i]!
          const b1 = bytes[i + 1]!
          gramBuf[0] = preLowered ? b0 : toAsciiLowerByte(b0)
          gramBuf[1] = preLowered ? b1 : toAsciiLowerByte(b1)
          const seed = u64(this.h64Raw(gramBuf.subarray(0, 2)))
          const idx = Number(seed % BigInt(rangeSize))
          indices.push((base + idx) & 0xffff)
        }
      }

      indices.sort((a, b) => a - b)
      return dedupSortedU16(indices)
    }

    const encoder = new TextEncoder()
    const textLower = preLowered ? trimmed : trimmed.toLowerCase()
    const chars = Array.from(textLower)
    const len = chars.length
    if (len === 0) return []

    const gramBuf = new Uint8Array(16)

    if (len >= 4) {
      for (let i = 0; i <= len - 4; i++) {
        let pos = 0
        let hasDigit = false

        for (let j = 0; j < 4; j++) {
          const c = chars[i + j]!
          const cp = c.codePointAt(0)!
          if (cp >= 0x30 && cp <= 0x39) hasDigit = true

          const out = encoder.encodeInto(c, gramBuf.subarray(pos))
          pos += out.written
        }

        let seed = u64(this.h64Raw(gramBuf.subarray(0, pos)))
        if (hasDigit) seed = rotr64(u64(seed ^ 0x1234567812345678n), 3)

        for (let k = 0n; k < 20n; k++) {
          const s = u64(seed + k * 9999n)
          const idx = Number(s % BigInt(rangeSize))
          indices.push((base + idx) & 0xffff)
        }
      }
    }

    if (len >= 3) {
      for (let i = 0; i <= len - 3; i++) {
        let pos = 0
        let hasDigit = false

        for (let j = 0; j < 3; j++) {
          const c = chars[i + j]!
          const cp = c.codePointAt(0)!
          if (cp >= 0x30 && cp <= 0x39) hasDigit = true

          const out = encoder.encodeInto(c, gramBuf.subarray(pos))
          pos += out.written
        }

        let seed = u64(this.h64Raw(gramBuf.subarray(0, pos)))
        if (hasDigit) seed = rotl64(u64(seed ^ 0x5f3759df5f3759dfn), 7)

        for (let k = 0n; k < 2n; k++) {
          const s = u64(seed + k * 1337n)
          const idx = Number(s % BigInt(rangeSize))
          indices.push((base + idx) & 0xffff)
        }
      }
    } else {
      const seed = u64(this.h64Raw(encoder.encode(textLower)))
      for (let k = 0n; k < 2n; k++) {
        const s = u64(seed + k * 1337n)
        const idx = Number(s % BigInt(rangeSize))
        indices.push((base + idx) & 0xffff)
      }
    }

    if (len >= 2) {
      for (let i = 0; i <= len - 2; i++) {
        let pos = 0
        for (let j = 0; j < 2; j++) {
          const c = chars[i + j]!
          const out = encoder.encodeInto(c, gramBuf.subarray(pos))
          pos += out.written
        }
        const seed = u64(this.h64Raw(gramBuf.subarray(0, pos)))
        const idx = Number(seed % BigInt(rangeSize))
        indices.push((base + idx) & 0xffff)
      }
    }

    indices.sort((a, b) => a - b)
    return dedupSortedU16(indices)
  }
}
