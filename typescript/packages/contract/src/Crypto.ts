import { Effect } from "effect"
import { Tag } from "./Context"
import { CryptoError } from "./Errors"

export class Crypto extends Tag("aura.contract.Crypto")<
  Crypto,
  {
    deriveKeyFromPassword: (password: string, salt16: Uint8Array) => Effect.Effect<Uint8Array, CryptoError>
    encryptData: (
      plaintext: Uint8Array,
      key32: Uint8Array,
      nonce?: Uint8Array
    ) => Effect.Effect<Uint8Array, CryptoError>
    decryptData: (encrypted: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array, CryptoError>
    computeHmac: (data: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array, CryptoError>
  }
>() {}
