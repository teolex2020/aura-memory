export type Bytes = Uint8Array

const te = new TextEncoder()

export function fixedBytes(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len)
  const b = te.encode(s)
  out.set(b.subarray(0, len), 0)
  return out
}
