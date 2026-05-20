import { Context } from "effect"

export const Tag = (key: string) => <Self, Shape>() => Context.Service<Self, Shape>()(key)

