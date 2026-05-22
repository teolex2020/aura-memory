import { Data } from "effect"

export class SdrInterpreterError extends Data.TaggedError("SdrInterpreterError")<{
  readonly cause: unknown
}> {}
