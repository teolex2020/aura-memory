import { Effect } from "effect"
import { Tag } from "./Context"

export class Crypto extends Tag("aura.contract.Crypto")<
  Crypto,
  {
    deriveKeyFromPassword: (password: string, salt16: Uint8Array) => Effect.Effect<Uint8Array>
    encryptData: (plaintext: Uint8Array, key32: Uint8Array, nonce?: Uint8Array) => Effect.Effect<Uint8Array>
    decryptData: (encrypted: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array>
    computeHmac: (data: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array>
  }
>() {}
