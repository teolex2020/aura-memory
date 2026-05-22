import { Effect, Layer } from "effect"
import { EpistemicTrace } from "@aura/contract"

export class EpistemicTraceImpl {
  event(name: string, fields: Readonly<Record<string, string | number | boolean>>): Effect.Effect<void> {
    return Effect.log(JSON.stringify({ type: "epistemic.event", name, fields }))
  }

  span<A, E, R>(
    name: string,
    fields: Readonly<Record<string, string | number | boolean>>,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> {
    const start = Effect.log(JSON.stringify({ type: "epistemic.span", phase: "start", name, fields }))
    const end = Effect.log(JSON.stringify({ type: "epistemic.span", phase: "end", name, fields }))
    return Effect.flatMap(start, () => Effect.ensuring(effect, end))
  }
}

export const EpistemicTraceLive = Layer.succeed(EpistemicTrace, new EpistemicTraceImpl())
