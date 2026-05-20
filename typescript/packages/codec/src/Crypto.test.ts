import { it } from "vitest"
import { assert } from "@effect/vitest"
import { computeHmac, decryptData, deriveKeyFromPassword, encryptData } from "./index"

const ORACLE = {
  key_hex: "b37c7b747648fbe8c5f3dfbe83fb2534fce70caf35f689f4dcd90c75f3de9431",
  encrypted_hex: "fee965fa7675789761bed1b9c2277bc3f6172599cc8cc3174e621c5b15b4a890170ced6cc8fae5a7eba7b5f38f7fe9ca11",
  hmac_hex: "e8e07238c9219fe1aaa437fbf7cdbbd46fea3665567bbc6d683be52307b9529b"
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("bad hex")
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

it("deriveKeyFromPassword matches rust oracle", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  assert.strictEqual(bytesToHex(key), ORACLE.key_hex)
})

it("decrypt rust encrypted payload and match HMAC", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  const enc = hexToBytes(ORACLE.encrypted_hex)
  const pt = await decryptData(enc, key)
  assert.strictEqual(new TextDecoder().decode(pt), "aura-ts-crypto-oracle")
  assert.strictEqual(bytesToHex(computeHmac(enc, key)), ORACLE.hmac_hex)
})

it("encrypt then decrypt locally", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  const pt = new TextEncoder().encode("hello")
  const enc = await encryptData(pt, key)
  const dec = await decryptData(enc, key)
  assert.strictEqual(new TextDecoder().decode(dec), "hello")
})
