import { Effect, Layer } from "effect"
import { Clock } from "@aura/contract"

export const NodeClockLive = Layer.succeed(Clock, {
  nowSeconds: () => Effect.sync(() => Date.now() / 1000)
})

