import { Effect, Layer } from "effect"
import { Crypto, CryptoError } from "@aura/contract"
import { computeHmac, decryptData, deriveKeyFromPassword, encryptData } from "@aura/codec"

export const NodeCryptoLive = Layer.succeed(Crypto, {
  deriveKeyFromPassword: (password, salt16) =>
    Effect.tryPromise(() => deriveKeyFromPassword(password, salt16)).pipe(
      Effect.mapError((cause) => new CryptoError({ op: "deriveKeyFromPassword", cause }))
    ),
  encryptData: (plaintext, key32, nonce) =>
    Effect.try({
      try: () => encryptData(plaintext, key32, nonce),
      catch: (cause) => new CryptoError({ op: "encryptData", cause })
    }),
  decryptData: (encrypted, key32) =>
    Effect.try({
      try: () => decryptData(encrypted, key32),
      catch: (cause) => new CryptoError({ op: "decryptData", cause })
    }),
  computeHmac: (data, key32) =>
    Effect.try({
      try: () => computeHmac(data, key32),
      catch: (cause) => new CryptoError({ op: "computeHmac", cause })
    })
})
