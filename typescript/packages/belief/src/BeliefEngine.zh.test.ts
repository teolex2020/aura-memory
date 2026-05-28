import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { BeliefState, EpistemicTrace, Level, type EpistemicTraceImpl, type Record as AuraRecord } from "@aura/contract"
import { nowSecs } from "@aura/utils"
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
    created_at: nowSecs(),
    last_activated: 0,
    tags,
    connections: {},
    connection_types: {},
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

// ── P0-aligned Chinese tests ──
// With SDR subclustering and split_by_contradiction, coarse groups split into
// separate beliefs per subcluster (Rust behavior). Single-record subclusters
// are skipped (Rust's group_records.len() < 2 guard).

it("中文用例：SDR子簇分桶后每个子簇产生独立Belief，记录映射稳定", async () => {
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
  // 3 coarse groups (tag-based claim keys), each with 2 SDR subclusters
  assert.strictEqual(report.coarse_groups, 3)
  // Each SDR subcluster becomes its own belief (6 total)
  assert.strictEqual(report.beliefs_created, 6)
  // Each belief gets 1 hypothesis (from supporting side, no contradictions)
  assert.strictEqual(report.total_hypotheses, 6)

  const state = await Effect.runPromise(engine.stats())
  assert.strictEqual(Object.keys(state.beliefs).length, 6)
  assert.strictEqual(Object.keys(state.hypotheses).length, 6)

  // Records within the same SDR subcluster map to the same belief
  const byBelief: Record<string, string[]> = {}
  for (const [rid, bid] of Object.entries(state.record_to_belief)) {
    ;(byBelief[bid] ??= []).push(rid)
  }
  assert.strictEqual(Object.keys(byBelief).length, 6)

  // All group1 dark records should be in the same belief
  const darkBids = new Set(group1.slice(0, 20).map(rid => state.record_to_belief[rid]))
  assert.strictEqual(darkBids.size, 1)
  // All group1 light records should be in the same belief (different from dark)
  const lightBids = new Set(group1.slice(20).map(rid => state.record_to_belief[rid]))
  assert.strictEqual(lightBids.size, 1)
  assert.notStrictEqual([...darkBids][0], [...lightBids][0])
})

it("中文用例：SDR分簇后每组单记录不产生Belief（Rust guard对齐）", async () => {
  const engine = new BeliefEngineImpl()

  // Two records with different SDR: Rust subclustering splits them into
  // single-record clusters, which are skipped (group_records.len() < 2).
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
  // SDR splits into 2 single-record clusters, both skipped (Rust <2 guard)
  assert.strictEqual(beliefs.length, 0)
})

it("中文用例：相同SDR簇内records通过contradiction产生supporting/opposing假设", async () => {
  const engine = new BeliefEngineImpl()

  // Two records with similar SDR (same cluster) but different support levels
  // With the same SDR vector, they merge into one subcluster and pass the <2 guard
  const records = new Map<string, AuraRecord>([
    ["a", makeRecord("a", "用户非常偏好深色主题（中文长句保证长度）", ["界面", "主题"], "偏好", 10, 0.95)],
    ["b", makeRecord("b", "用户有时用浅色主题（中文长句保证长度）", ["界面", "主题"], "偏好", 1, 0.5)]
  ])
  const sdr = new Map<string, ReadonlyArray<number>>([
    ["a", [1, 2, 3, 4, 5]],
    ["b", [1, 2, 3, 4, 6]]   // Tanimoto = 4/6 ≈ 0.67 > 0.15 → merge
  ])

  await Effect.runPromise(engine.update_with_sdr(records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  const state = await Effect.runPromise(engine.stats())
  const beliefs = Object.values(state.beliefs)
  assert.strictEqual(beliefs.length, 1)
  assert.strictEqual(beliefs[0]!.state, BeliefState.Singleton)
  assert.ok(beliefs[0]!.winner_id !== null)
  const winner = state.hypotheses[beliefs[0]!.winner_id!]
  assert.ok(winner !== undefined)
  assert.ok(winner!.support_mass >= 10)
})
