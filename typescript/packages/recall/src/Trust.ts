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

export function computeEffectiveTrust(
  metadata: Record<string, string>,
  nowUnixSec: number,
  config: TrustConfig,
  sourceType: string
): number {
  // SIMPLE IMPLEMENTATION: 复刻 Rust 的关键信号（base trust + authority + recency boost + source_type factor），但解析 timestamp 的容错更宽松。
  // FULL IMPLEMENTATION: 与 Rust [trust.rs](file:///workspace/src/trust.rs) 的字段名/解析规则/数值边界逐字节对齐，并补齐来源分布与审计日志。
  const trustRaw = Number.parseFloat(metadata["trust_score"] ?? "0.5")
  const trust = Number.isFinite(trustRaw) ? trustRaw : 0.5

  const source = metadata["source"] ?? ""
  const authority = config.source_authority[source] ?? 0.85

  const tsStr = metadata["timestamp"] ?? metadata["created_at"] ?? ""
  const parsedMs = Date.parse(tsStr)
  const tsUnix = Number.isFinite(parsedMs) ? parsedMs / 1000 : nowUnixSec - 86400 * 14

  const ageDays = Math.max(0, (nowUnixSec - tsUnix) / 86400)
  const decay = Math.pow(0.5, ageDays / Math.max(0.0001, config.recency_half_life_days))
  const recencyBoost = config.recency_boost_max * decay

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

