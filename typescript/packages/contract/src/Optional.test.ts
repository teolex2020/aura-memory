import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Option } from "effect"
import { serviceOption, Tag } from "./index"

class TestService extends Tag("aura.contract.TestService")<
  TestService,
  {
    n: number
  }
>() {}

it("serviceOption returns none when service is missing", async () => {
  const result = await Effect.runPromise(serviceOption(TestService))
  assert.strictEqual(Option.isNone(result), true)
})

it("serviceOption returns some when service is provided", async () => {
  const program = serviceOption(TestService).pipe(
    Effect.provideService(TestService, {
      n: 123
    })
  )
  const result = await Effect.runPromise(program)
  assert.strictEqual(Option.isSome(result), true)
  if (Option.isSome(result)) {
    assert.strictEqual(result.value.n, 123)
  }
})
