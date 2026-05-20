import { Context, Effect, Option } from "effect"

export function serviceOption<I, S>(key: Context.Key<I, S>): Effect.Effect<Option.Option<S>> {
  return Effect.contextWith((ctx) => Effect.succeed(Context.getOption(ctx, key)))
}
