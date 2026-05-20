import { Effect } from "effect"
import { Tag } from "./Context"

export class Clock extends Tag("aura.contract.Clock")<
  Clock,
  {
    nowSeconds: () => Effect.Effect<number>
  }
>() {}
