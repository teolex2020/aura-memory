import { Effect, Layer } from "effect"
import { Crypto } from "@aura/contract"
import { computeHmac, decryptData, deriveKeyFromPassword, encryptData } from "@aura/codec"

export const NodeCryptoLive = Layer.succeed(Crypto, {
  deriveKeyFromPassword: (password, salt16) => Effect.tryPromise(() => deriveKeyFromPassword(password, salt16)),
  encryptData: (plaintext, key32, nonce) => Effect.sync(() => encryptData(plaintext, key32, nonce)),
  decryptData: (encrypted, key32) => Effect.sync(() => decryptData(encrypted, key32)),
  computeHmac: (data, key32) => Effect.sync(() => computeHmac(data, key32))
})

