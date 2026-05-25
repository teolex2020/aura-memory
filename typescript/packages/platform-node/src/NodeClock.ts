import { Effect, Layer } from "effect"
import { Clock } from "@aura/contract"
import { nowSecs } from "@aura/utils"

export const NodeClockLive = Layer.succeed(Clock, {
  nowSeconds: () => Effect.sync(nowSecs)
})
