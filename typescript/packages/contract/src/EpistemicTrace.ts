import { Effect } from "effect"
import { Tag } from "./Context"

export type TraceFields = Readonly<Record<string, string | number | boolean>>

export type EpistemicTraceImpl = {
  event: (name: string, fields: TraceFields) => Effect.Effect<void>
  span: <A, E, R>(
    name: string,
    fields: TraceFields,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
}

export class EpistemicTrace extends Tag("aura.contract.EpistemicTrace")<
  EpistemicTrace,
  EpistemicTraceImpl
>() {}
