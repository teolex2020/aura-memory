import { argon2id } from "argon2-wasm-edge"
import { chacha20poly1305 } from "@noble/ciphers/chacha"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"

export async function deriveKeyFromPassword(password: string, salt16: Uint8Array): Promise<Uint8Array> {
  if (salt16.length !== 16) {
    throw new Error("salt must be 16 bytes")
  }
  const out = await (argon2id as any)({
    password,
    salt: salt16,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "binary"
  })
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export function encryptData(
  plaintext: Uint8Array,
  key32: Uint8Array,
  nonce?: Uint8Array
): Uint8Array {
  if (key32.length !== 32) {
    throw new Error("key must be 32 bytes")
  }
  const n = nonce ?? generateNonce()
  if (n.length !== 12) {
    throw new Error("nonce must be 12 bytes")
  }
  const cipher = chacha20poly1305(key32, n)
  const ciphertext = cipher.encrypt(plaintext)
  const out = new Uint8Array(12 + ciphertext.length)
  out.set(n, 0)
  out.set(ciphertext, 12)
  return out
}

export function decryptData(encrypted: Uint8Array, key32: Uint8Array): Uint8Array {
  if (key32.length !== 32) {
    throw new Error("key must be 32 bytes")
  }
  if (encrypted.length < 12 + 16) {
    throw new Error("encrypted data too short")
  }
  const nonce = encrypted.subarray(0, 12)
  const ciphertext = encrypted.subarray(12)
  const cipher = chacha20poly1305(key32, nonce)
  return cipher.decrypt(ciphertext)
}

export function computeHmac(data: Uint8Array, key32: Uint8Array): Uint8Array {
  if (key32.length !== 32) {
    throw new Error("key must be 32 bytes")
  }
  return hmac(sha256, key32, data)
}
