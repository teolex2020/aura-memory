const U64_MASK = (1n << 64n) - 1n
const PRIME32_1 = 0x9e3779b1n
const PRIME32_2 = 0x85ebca77n
const PRIME32_3 = 0xc2b2ae3dn
const PRIME64_1 = 0x9e3779b185ebca87n
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn
const PRIME64_3 = 0x165667b19e3779f9n
const PRIME64_4 = 0x85ebca77c2b2ae63n
const PRIME64_5 = 0x27d4eb2f165667c5n
const XXH3_AVALANCHE_PRIME = 0x165667919e3779f9n
const XXH3_STRONG_AVALANCHE_PRIME = 0x9fb21c651e98df25n
const STRIPE_LEN = 64
const SECRET_CONSUME_RATE = 8
const ACC_NB = 8
const SECRET_MERGEACCS_START = 11
const SECRET_LASTACC_START = 7
const MID_SIZE_MAX = 240

const encoder = new TextEncoder()

/**
 * Rust `xxhash_rust::xxh3::DEFAULT_SECRET`.
 * 中文说明：默认 secret 必须逐字节对齐 Rust/C xxHash3，否则所有 ID 与 fingerprint 都会漂移。
 */
const DEFAULT_SECRET = Uint8Array.from([
  0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
  0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
  0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
  0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
  0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
  0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
  0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
  0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
  0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
  0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
  0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
  0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e
])

/**
 * Rust `INITIAL_ACC` from `xxhash-rust/src/xxh3.rs`.
 * 中文说明：long input 路径使用 8 lane accumulator，对齐 scalar/SIMD 共同语义。
 */
const INITIAL_ACC = [
  PRIME32_3,
  PRIME64_1,
  PRIME64_2,
  PRIME64_3,
  PRIME64_4,
  PRIME32_2,
  PRIME64_5,
  PRIME32_1
] as const

/**
 * Keep an arithmetic result in Rust `u64` wrapping range.
 * 中文说明：BigInt 不会溢出，所有乘加/移位后必须显式截断到 u64。
 */
function u64(value: bigint): bigint {
  return value & U64_MASK
}

/**
 * Read a little-endian `u32` from a byte slice.
 * 中文说明：对齐 Rust `read_32le_unaligned`。
 */
function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0
}

/**
 * Read a little-endian `u64` from a byte slice.
 * 中文说明：对齐 Rust `read_64le_unaligned`。
 */
function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let out = 0n
  for (let i = 0; i < 8; i++) {
    out |= BigInt(bytes[offset + i]!) << BigInt(i * 8)
  }
  return out
}

/**
 * Swap byte order for a Rust `u64`.
 * 中文说明：用于 `xxh3_64_9to16` 中的 `input_lo.swap_bytes()`。
 */
function swapBytes64(value: bigint): bigint {
  let out = 0n
  for (let i = 0; i < 8; i++) {
    out = (out << 8n) | ((value >> BigInt(i * 8)) & 0xffn)
  }
  return out
}

/**
 * Rotate a Rust `u64` left.
 * 中文说明：用于 `strong_avalanche`，旋转后保持 u64 wrapping。
 */
function rotl64(value: bigint, bits: bigint): bigint {
  return u64((value << bits) | (value >> (64n - bits)))
}

/**
 * Rust `xxh64_common::avalanche`.
 * 中文说明：XXH3 的 0/1..3 byte 路径沿用 XXH64 avalanche。
 */
function xxh64Avalanche(input: bigint): bigint {
  let value = u64(input)
  value ^= value >> 33n
  value = u64(value * PRIME64_2)
  value ^= value >> 29n
  value = u64(value * PRIME64_3)
  value ^= value >> 32n
  return u64(value)
}

/**
 * Rust `xxh3_common::avalanche`.
 * 中文说明：XXH3 中长输入 merge 和 17..240 byte 路径使用此 avalanche。
 */
function avalanche(input: bigint): bigint {
  let value = u64(input)
  value ^= value >> 37n
  value = u64(value * XXH3_AVALANCHE_PRIME)
  value ^= value >> 32n
  return u64(value)
}

/**
 * Rust `xxh3_common::strong_avalanche`.
 * 中文说明：对齐 4..8 byte 路径的强 avalanche。
 */
function strongAvalanche(input: bigint, len: number): bigint {
  let value = u64(input)
  value ^= rotl64(value, 49n) ^ rotl64(value, 24n)
  value = u64(value * XXH3_STRONG_AVALANCHE_PRIME)
  value ^= u64((value >> 35n) + BigInt(len))
  value = u64(value * XXH3_STRONG_AVALANCHE_PRIME)
  value ^= value >> 28n
  return u64(value)
}

/**
 * Rust `mul128_fold64`.
 * 中文说明：BigInt 直接计算 128-bit 乘积，再折叠高低 64 位。
 */
function mul128Fold64(left: bigint, right: bigint): bigint {
  const product = u64(left) * u64(right)
  return u64(product ^ (product >> 64n))
}

/**
 * Rust `mix16_b` with seed fixed to 0 for `xxh3_64`.
 * 中文说明：Aura Rust 当前只调用无 seed 的 `xxh3_64`，因此这里投影默认 seed 语义。
 */
function mix16B(input: Uint8Array, inputOffset: number, secretOffset: number): bigint {
  const inputLo = readU64LE(input, inputOffset) ^ readU64LE(DEFAULT_SECRET, secretOffset)
  const inputHi = readU64LE(input, inputOffset + 8) ^ readU64LE(DEFAULT_SECRET, secretOffset + 8)
  return mul128Fold64(inputLo, inputHi)
}

/**
 * Rust `xxh3_64_1to3`.
 * 中文说明：覆盖 1..3 byte 输入，NGram short hash 也复用此路径。
 */
function xxh3_64_1to3(input: Uint8Array): bigint {
  const len = input.length
  const c1 = input[0]!
  const c2 = input[len >> 1]!
  const c3 = input[len - 1]!
  const combo = (((c1 << 16) >>> 0) | ((c2 << 24) >>> 0) | c3 | (len << 8)) >>> 0
  const flip = BigInt((readU32LE(DEFAULT_SECRET, 0) ^ readU32LE(DEFAULT_SECRET, 4)) >>> 0)
  return xxh64Avalanche(BigInt(combo) ^ flip)
}

/**
 * Rust `xxh3_64_4to8`.
 * 中文说明：覆盖 4..8 byte 输入。
 */
function xxh3_64_4to8(input: Uint8Array): bigint {
  const input1 = readU32LE(input, 0)
  const input2 = readU32LE(input, input.length - 4)
  const flip = readU64LE(DEFAULT_SECRET, 8) ^ readU64LE(DEFAULT_SECRET, 16)
  const input64 = u64(BigInt(input2) + (BigInt(input1) << 32n))
  return strongAvalanche(input64 ^ flip, input.length)
}

/**
 * Rust `xxh3_64_9to16`.
 * 中文说明：覆盖 9..16 byte 输入。
 */
function xxh3_64_9to16(input: Uint8Array): bigint {
  const flip1 = readU64LE(DEFAULT_SECRET, 24) ^ readU64LE(DEFAULT_SECRET, 32)
  const flip2 = readU64LE(DEFAULT_SECRET, 40) ^ readU64LE(DEFAULT_SECRET, 48)
  const inputLo = readU64LE(input, 0) ^ flip1
  const inputHi = readU64LE(input, input.length - 8) ^ flip2
  const acc = u64(BigInt(input.length) + swapBytes64(inputLo) + inputHi + mul128Fold64(inputLo, inputHi))
  return avalanche(acc)
}

/**
 * Rust `xxh3_64_0to16`.
 * 中文说明：0..16 byte dispatcher。
 */
function xxh3_64_0to16(input: Uint8Array): bigint {
  if (input.length > 8) return xxh3_64_9to16(input)
  if (input.length >= 4) return xxh3_64_4to8(input)
  if (input.length > 0) return xxh3_64_1to3(input)
  return xxh64Avalanche(readU64LE(DEFAULT_SECRET, 56) ^ readU64LE(DEFAULT_SECRET, 64))
}

/**
 * Rust `xxh3_64_7to128`.
 * 中文说明：实际由 17..128 byte dispatcher 调用，函数名保留 Rust 原始命名。
 */
function xxh3_64_7to128(input: Uint8Array): bigint {
  let acc = u64(BigInt(input.length) * PRIME64_1)
  if (input.length > 32) {
    if (input.length > 64) {
      if (input.length > 96) {
        acc = u64(acc + mix16B(input, 48, 96))
        acc = u64(acc + mix16B(input, input.length - 64, 112))
      }
      acc = u64(acc + mix16B(input, 32, 64))
      acc = u64(acc + mix16B(input, input.length - 48, 80))
    }
    acc = u64(acc + mix16B(input, 16, 32))
    acc = u64(acc + mix16B(input, input.length - 32, 48))
  }
  acc = u64(acc + mix16B(input, 0, 0))
  acc = u64(acc + mix16B(input, input.length - 16, 16))
  return avalanche(acc)
}

/**
 * Rust `xxh3_64_129to240`.
 * 中文说明：覆盖中等长度输入，包含 first 8 rounds、二次 avalanche 与 last round。
 */
function xxh3_64_129to240(input: Uint8Array): bigint {
  const START_OFFSET = 3
  const LAST_OFFSET = 17
  let acc = u64(BigInt(input.length) * PRIME64_1)
  const nbRounds = Math.floor(input.length / 16)
  let idx = 0
  while (idx < 8) {
    acc = u64(acc + mix16B(input, 16 * idx, 16 * idx))
    idx++
  }
  acc = avalanche(acc)
  while (idx < nbRounds) {
    acc = u64(acc + mix16B(input, 16 * idx, 16 * (idx - 8) + START_OFFSET))
    idx++
  }
  acc = u64(acc + mix16B(input, input.length - 16, 136 - LAST_OFFSET))
  return avalanche(acc)
}

/**
 * Rust scalar `accumulate_512`.
 * 中文说明：long input 路径的 SIMD/scalar 版本语义一致，TS 采用 scalar 投影。
 */
function accumulate512(acc: bigint[], input: Uint8Array, inputOffset: number, secretOffset: number): void {
  for (let idx = 0; idx < ACC_NB; idx++) {
    const dataVal = readU64LE(input, inputOffset + idx * 8)
    const dataKey = dataVal ^ readU64LE(DEFAULT_SECRET, secretOffset + idx * 8)
    acc[idx ^ 1] = u64(acc[idx ^ 1]! + dataVal)
    const lo = dataKey & 0xffffffffn
    const hi = (dataKey >> 32n) & 0xffffffffn
    acc[idx] = u64(acc[idx]! + lo * hi)
  }
}

/**
 * Rust scalar `scramble_acc`.
 * 中文说明：每个 block 后对 accumulator 做 avalanche-like 扰动。
 */
function scrambleAcc(acc: bigint[], secretOffset: number): void {
  for (let idx = 0; idx < ACC_NB; idx++) {
    const key = readU64LE(DEFAULT_SECRET, secretOffset + idx * 8)
    const accVal = (acc[idx]! ^ (acc[idx]! >> 47n)) ^ key
    acc[idx] = u64(accVal * PRIME32_1)
  }
}

/**
 * Rust `accumulate_loop`.
 * 中文说明：按 64-byte stripe 累积 long input。
 */
function accumulateLoop(acc: bigint[], input: Uint8Array, inputOffset: number, secretOffset: number, nbStripes: number): void {
  for (let idx = 0; idx < nbStripes; idx++) {
    accumulate512(acc, input, inputOffset + idx * STRIPE_LEN, secretOffset + idx * SECRET_CONSUME_RATE)
  }
}

/**
 * Rust `hash_long_internal_loop`.
 * 中文说明：覆盖 241+ byte 输入，包含完整 blocks、partial block 与 last stripe。
 */
function hashLongInternalLoop(acc: bigint[], input: Uint8Array): void {
  const nbStripes = Math.floor((DEFAULT_SECRET.length - STRIPE_LEN) / SECRET_CONSUME_RATE)
  const blockLen = STRIPE_LEN * nbStripes
  const nbBlocks = Math.floor((input.length - 1) / blockLen)

  for (let idx = 0; idx < nbBlocks; idx++) {
    accumulateLoop(acc, input, idx * blockLen, 0, nbStripes)
    scrambleAcc(acc, DEFAULT_SECRET.length - STRIPE_LEN)
  }

  const nbTailStripes = Math.floor(((input.length - 1) - blockLen * nbBlocks) / STRIPE_LEN)
  accumulateLoop(acc, input, nbBlocks * blockLen, 0, nbTailStripes)
  accumulate512(acc, input, input.length - STRIPE_LEN, DEFAULT_SECRET.length - STRIPE_LEN - SECRET_LASTACC_START)
}

/**
 * Rust `merge_accs`.
 * 中文说明：将 long input 的 8-lane accumulator 折叠为最终 u64。
 */
function mergeAccs(acc: bigint[], result: bigint): bigint {
  let out = u64(result)
  for (let idx = 0; idx < 4; idx++) {
    const secretOffset = SECRET_MERGEACCS_START + idx * 16
    out = u64(
      out +
        mul128Fold64(
          acc[idx * 2]! ^ readU64LE(DEFAULT_SECRET, secretOffset),
          acc[idx * 2 + 1]! ^ readU64LE(DEFAULT_SECRET, secretOffset + 8)
        )
    )
  }
  return avalanche(out)
}

/**
 * Rust `xxh3_64_long_impl`.
 * 中文说明：默认 secret、无 seed 的 long input 路径。
 */
function xxh3_64_long(input: Uint8Array): bigint {
  const acc = [...INITIAL_ACC]
  hashLongInternalLoop(acc, input)
  return mergeAccs(acc, u64(BigInt(input.length) * PRIME64_1))
}

/**
 * Compute Rust-compatible `xxhash_rust::xxh3::xxh3_64`.
 * Rust reference: `xxhash-rust/src/xxh3.rs` and `xxh3_common.rs`.
 * 中文说明：当前仅投影 Aura Rust 使用的默认 seed/default secret `xxh3_64(input)`。
 */
export function xxh3_64(input: string | Uint8Array): bigint {
  const bytes = typeof input === "string" ? encoder.encode(input) : input
  if (bytes.length <= 16) return xxh3_64_0to16(bytes)
  if (bytes.length <= 128) return xxh3_64_7to128(bytes)
  if (bytes.length <= MID_SIZE_MAX) return xxh3_64_129to240(bytes)
  return xxh3_64_long(bytes)
}

/**
 * Compute lower-case 16-character Rust-compatible XXH3 hex.
 * 中文说明：用于 Rust `format!("{:016x}", xxh3_64(...))` 对齐。
 */
export function xxh3_64Hex(input: string | Uint8Array): string {
  return xxh3_64(input).toString(16).padStart(16, "0")
}
