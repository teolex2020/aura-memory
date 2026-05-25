import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { BeliefState, EpistemicTrace, Level, type EpistemicTraceImpl, type Record as AuraRecord } from "@aura/contract"
import { BeliefEngineImpl } from "./BeliefEngine"

const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

function makeRecord(
  id: string,
  content: string,
  tags: ReadonlyArray<string>,
  semantic_type: string,
  support_mass: number,
  confidence: number
): AuraRecord {
  return {
    id,
    content,
    level: Level.Working,
    strength: 1,
    activation_count: 0,
    created_at: Date.now() / 1000,
    last_activated: 0,
    tags,
    connections: {},
    content_type: "text/plain",
    source_type: "recorded",
    namespace: "default",
    semantic_type,
    metadata: {},
    aura_id: null,
    caused_by_id: null,
    confidence,
    support_mass,
    conflict_mass: 0
  }
}

it("中文用例：大样本分桶+SDR聚类后，每个桶只生成一个Belief，且记录映射稳定", async () => {
  const engine = new BeliefEngineImpl()

  const records = new Map<string, AuraRecord>()
  const sdr = new Map<string, ReadonlyArray<number>>()

  const group1: string[] = []
  const group2: string[] = []
  const group3: string[] = []

  for (let i = 0; i < 20; i++) {
    const id = `g1_dark_${i}`
    group1.push(id)
    records.set(id, makeRecord(id, `用户偏好深色主题：${i}`, ["界面", "主题"], "偏好", 5, 0.9))
    sdr.set(id, [1, 2, 3, 4, 5])
  }
  for (let i = 0; i < 20; i++) {
    const id = `g1_light_${i}`
    group1.push(id)
    records.set(id, makeRecord(id, `用户偶尔使用浅色主题：${i}`, ["界面", "主题"], "偏好", 1, 0.9))
    sdr.set(id, [100, 200, 300, 400, 500])
  }

  for (let i = 0; i < 10; i++) {
    const id = `g2_vim_${i}`
    group2.push(id)
    records.set(id, makeRecord(id, `用户经常使用Vim快捷键：${i}`, ["编辑器", "快捷键"], "习惯", 3, 0.8))
    sdr.set(id, [10, 11, 12, 13, 14])
  }
  for (let i = 0; i < 10; i++) {
    const id = `g2_emacs_${i}`
    group2.push(id)
    records.set(id, makeRecord(id, `用户偶尔使用Emacs风格：${i}`, ["编辑器", "快捷键"], "习惯", 2, 0.8))
    sdr.set(id, [210, 211, 212, 213, 214])
  }

  for (let i = 0; i < 10; i++) {
    const id = `g3_rust_${i}`
    group3.push(id)
    records.set(id, makeRecord(id, `项目主要使用Rust：${i}`, ["项目", "语言"], "事实", 4, 0.85))
    sdr.set(id, [20, 21, 22, 23, 24])
  }
  for (let i = 0; i < 10; i++) {
    const id = `g3_ts_${i}`
    group3.push(id)
    records.set(id, makeRecord(id, `项目同时使用TypeScript：${i}`, ["项目", "语言"], "事实", 4, 0.85))
    sdr.set(id, [220, 221, 222, 223, 224])
  }

  const report = await Effect.runPromise(engine.update_with_sdr(records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  assert.strictEqual(report.coarse_groups, 3)
  assert.strictEqual(report.beliefs_built, 3)
  assert.strictEqual(report.hypotheses_built, 6)

  const state = await Effect.runPromise(engine.stats())
  assert.strictEqual(Object.keys(state.beliefs).length, 3)
  assert.strictEqual(Object.keys(state.hypotheses).length, 6)

  const byBelief: Record<string, string[]> = {}
  for (const [rid, bid] of Object.entries(state.record_to_belief)) {
    ;(byBelief[bid] ??= []).push(rid)
  }
  assert.strictEqual(Object.keys(byBelief).length, 3)

  const g1Belief = state.record_to_belief[group1[0]!]!
  const g2Belief = state.record_to_belief[group2[0]!]!
  const g3Belief = state.record_to_belief[group3[0]!]!
  for (const rid of group1) assert.strictEqual(state.record_to_belief[rid], g1Belief)
  for (const rid of group2) assert.strictEqual(state.record_to_belief[rid], g2Belief)
  for (const rid of group3) assert.strictEqual(state.record_to_belief[rid], g3Belief)
})

it("中文用例：两组假设分数接近时应进入Unresolved（不产生winner）", async () => {
  const engine = new BeliefEngineImpl()

  const records = new Map<string, AuraRecord>([
    ["a", makeRecord("a", "用户偏好深色主题（强，中文长句保证长度）", ["界面", "主题"], "偏好", 10, 0.9)],
    ["b", makeRecord("b", "用户偏好浅色主题（近似强，中文长句保证长度）", ["界面", "主题"], "偏好", 9.5, 0.9)]
  ])
  const sdr = new Map<string, ReadonlyArray<number>>([
    ["a", [1, 2, 3]],
    ["b", [100, 200, 300]]
  ])

  await Effect.runPromise(engine.update_with_sdr(records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  const state = await Effect.runPromise(engine.stats())
  const beliefs = Object.values(state.beliefs)
  assert.strictEqual(beliefs.length, 1)
  assert.strictEqual(beliefs[0]!.state, BeliefState.Unresolved)
  assert.strictEqual(beliefs[0]!.winner_id, null)
})

it("中文用例：明显更强的假设应Resolved且winner来自更高support_mass簇", async () => {
  const engine = new BeliefEngineImpl()

  const records = new Map<string, AuraRecord>([
    ["a", makeRecord("a", "用户非常偏好深色主题（中文长句保证长度）", ["界面", "主题"], "偏好", 10, 0.95)],
    ["b", makeRecord("b", "用户有时用浅色主题（中文长句保证长度）", ["界面", "主题"], "偏好", 1, 0.5)]
  ])
  const sdr = new Map<string, ReadonlyArray<number>>([
    ["a", [1, 2, 3]],
    ["b", [100, 200, 300]]
  ])

  await Effect.runPromise(engine.update_with_sdr(records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  const state = await Effect.runPromise(engine.stats())
  const beliefs = Object.values(state.beliefs)
  assert.strictEqual(beliefs.length, 1)
  assert.strictEqual(beliefs[0]!.state, BeliefState.Resolved)
  assert.ok(beliefs[0]!.winner_id !== null)
  const winner = state.hypotheses[beliefs[0]!.winner_id!]
  assert.ok(winner !== undefined)
  assert.ok(winner!.support_mass >= 10)
})
