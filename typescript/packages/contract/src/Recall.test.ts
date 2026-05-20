import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  BoundedReranker,
  EmbeddingStore,
  RecallFinalizer,
  RecallViewTag,
  serviceOption,
  TrustConfigTag
} from "./index"

it("RecallViewTag can be provided and used", async () => {
  const program = Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    assert.strictEqual(view.records.size, 1)
  }).pipe(
    Effect.provideService(RecallViewTag, {
      records: new Map([["r1", { id: "r1" }]]),
      auraIndex: new Map(),
      auraHeaders: new Map(),
      invertedIndex: { search: () => [] },
      ngramIndex: { query: () => [] },
      tagIndex: new Map()
    })
  )

  await Effect.runPromise(program)
})

it("Recall-related tags can be accessed optionally via Optional.serviceOption", async () => {
  const [view, embeddingStore, reranker, finalizer, trust] = await Effect.runPromise(
    Effect.all([
      serviceOption(RecallViewTag),
      serviceOption(EmbeddingStore),
      serviceOption(BoundedReranker),
      serviceOption(RecallFinalizer),
      serviceOption(TrustConfigTag)
    ])
  )
  assert.strictEqual(Option.isNone(view), true)
  assert.strictEqual(Option.isNone(embeddingStore), true)
  assert.strictEqual(Option.isNone(reranker), true)
  assert.strictEqual(Option.isNone(finalizer), true)
  assert.strictEqual(Option.isNone(trust), true)
})

it("TrustConfigTag can be provided and accessed", async () => {
  const program = Effect.service(TrustConfigTag).pipe(
    Effect.provideService(TrustConfigTag, {
      source_trust: { agent: 0.5 },
      source_authority: { agent: 0.85 },
      recency_boost_max: 0.2,
      recency_half_life_days: 7
    })
  )
  const result = await Effect.runPromise(program)
  assert.strictEqual(result.source_trust.agent, 0.5)
})
