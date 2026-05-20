export type Hex = string

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("bad hex")
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const n = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(n)) {
      throw new Error("bad hex")
    }
    out[i] = n
  }
  return out
}

export function bytesToHex(buf: Uint8Array): Hex {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("") as Hex
}
