import type { TrustConfig } from "@aura/contract"

export function defaultTrustConfig(): TrustConfig {
  return {
    source_trust: {
      "user-confirmed": 1.0,
      "agent-interactive": 0.7,
      system: 0.6,
      agent: 0.5,
      "agent-autonomous": 0.4,
      "agent-worker": 0.35
    },
    source_authority: {
      "user-telegram": 1.2,
      "user-desktop": 1.2,
      "user-voice": 1.2,
      "user-confirmed": 1.2,
      "agent-interactive": 1.0,
      system: 0.9,
      agent: 0.85,
      "agent-autonomous": 0.75,
      "agent-worker": 0.7,
      "agent-inference": 0.65
    },
    recency_boost_max: 0.2,
    recency_half_life_days: 7.0
  }
}

/**
 * 计算有效信任分（effective trust），用于召回排序。
 *
 * 公式与 Rust [trust.rs](file:///workspace/src/trust.rs) 的 `compute_effective_trust` 对齐：
 *   effective = (trust + recency_boost) * authority * source_type_factor
 * 其中 recency_boost 采用线性衰减：
 *   recency_boost = max(0, recency_boost_max * (1 - age_days / half_life_days))
 * 最终结果被 clamp 到 [0.05, 1.0]。
 *
 * timestamp 解析优先通过 `Date.parse` 处理（可兼容 RFC3339 / ISO8601），
 * 解析失败时回退为 "14 天前"，与 Rust 的回退策略一致。
 */
export function computeEffectiveTrust(
  metadata: Record<string, string>,
  nowUnixSec: number,
  config: TrustConfig,
  sourceType: string
): number {
  const trustRaw = Number.parseFloat(metadata["trust_score"] ?? "0.5")
  const trust = Number.isFinite(trustRaw) ? trustRaw : 0.5

  const source = metadata["source"] ?? ""
  const authority = config.source_authority[source] ?? 0.85

  const tsStr = metadata["timestamp"] ?? metadata["created_at"] ?? ""
  const parsedMs = Date.parse(tsStr)
  const tsUnix = Number.isFinite(parsedMs) ? parsedMs / 1000 : nowUnixSec - 86400 * 14

  const ageDays = Math.max(0, (nowUnixSec - tsUnix) / 86400)
  const recencyBoost = Math.max(
    0,
    config.recency_boost_max * (1 - ageDays / config.recency_half_life_days)
  )

  const sourceTypeFactor =
    sourceType === "recorded"
      ? 1.0
      : sourceType === "retrieved"
        ? 0.9
        : sourceType === "inferred"
          ? 0.85
          : sourceType === "generated"
            ? 0.8
            : 0.9

  const effective = (trust + recencyBoost) * authority * sourceTypeFactor
  return Math.min(1.0, Math.max(0.05, effective))
}
