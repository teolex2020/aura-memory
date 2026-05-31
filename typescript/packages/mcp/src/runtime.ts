import { Aura, DefaultLayer } from "@aura/core"
import {
  NodeClockLive,
  NodeCryptoLive,
  NodeFileReadLive,
  NodeFileWriteLive,
} from "@aura/platform-node"
import { Effect, Layer } from "effect"

export type AuraMcpRuntime = {
  readonly brainPath: string
  readonly aura: Aura
  readonly runEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
}

export function resolveBrainPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AURA_BRAIN_PATH ?? "./aura_brain"
}

function nodeLayer(brainPath: string) {
  const platform = Layer.mergeAll(
    NodeFileReadLive,
    NodeFileWriteLive,
    NodeClockLive,
    NodeCryptoLive,
  )
  return Layer.mergeAll(
    DefaultLayer(brainPath).pipe(Layer.provide(platform)),
    platform,
  )
}

export async function openAuraRuntime(env: NodeJS.ProcessEnv = process.env): Promise<AuraMcpRuntime> {
  const brainPath = resolveBrainPath(env)
  const password = env.AURA_PASSWORD
  const layer = nodeLayer(brainPath)
  const open = password === undefined
    ? Aura.open(brainPath)
    : Aura.open_with_password(brainPath, password)
  const runEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      // The MCP process owns the complete Aura runtime layer for its bound brain.
      Effect.provide(effect, layer) as Effect.Effect<A, E, never>
    )
  const aura = await runEffect(open)
  return { brainPath, aura, runEffect }
}

export function toText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}
