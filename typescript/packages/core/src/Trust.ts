import type { TrustConfig } from "@aura/contract"

/**
 * User-configurable tag classification for store-time trust/provenance guards.
 *
 * @zh 写入期 trust/provenance guard 使用的 tag taxonomy；字段对齐 Rust `TagTaxonomy`。
 *
 * Rust reference: `TagTaxonomy` (`../src/trust.rs`).
 */
export type TagTaxonomy = {
  readonly identityTags: ReadonlySet<string>
  readonly stableTags: ReadonlySet<string>
  readonly volatileTags: ReadonlySet<string>
  readonly nonIdentityTags: ReadonlySet<string>
  readonly consolidationSkipTags: ReadonlySet<string>
  readonly archiveProtectedTags: ReadonlySet<string>
  readonly sensitiveTags: ReadonlySet<string>
}

/**
 * Provenance metadata stamped on every stored record.
 *
 * @zh 每条写入 record 的 provenance 元数据；对齐 Rust `Provenance`。
 *
 * Rust reference: `Provenance` (`../src/trust.rs`).
 */
export type Provenance = {
  readonly source: string
  readonly verified: boolean
  readonly trustScore: number
  readonly volatility: string
  readonly timestamp: string
}

/**
 * Build the default store-time tag taxonomy.
 *
 * @zh 构造默认写入期 tag taxonomy；对齐 Rust `TagTaxonomy::default`。
 *
 * Rust reference: `impl Default for TagTaxonomy` (`../src/trust.rs`).
 */
export function createDefaultTagTaxonomy(): TagTaxonomy {
  return {
    identityTags: new Set(["user-profile", "identity"]),
    stableTags: new Set(["identity", "contact", "credential", "financial", "person"]),
    volatileTags: new Set(["cache", "scheduled-task", "todo-item", "web-search-cache"]),
    nonIdentityTags: new Set([
      "session-summary",
      "cache",
      "outcome",
      "plan",
      "reflection",
      "research-finding",
      "web-search-cache",
      "proactive-session",
      "action-plan",
      "session-reflection",
      "scheduled-task",
      "consolidated-meta",
      "research-project",
      "autonomous-outcome",
      "autonomous-goal",
    ]),
    consolidationSkipTags: new Set([
      "identity",
      "contact",
      "credential",
      "financial",
      "person",
      "user-profile",
      "session-summary",
      "scheduled-task",
      "health-metric",
      "extracted-fact",
      "todo-item",
    ]),
    archiveProtectedTags: new Set([
      "identity",
      "contact",
      "person",
      "health-metric",
      "extracted-fact",
      "relationship",
    ]),
    sensitiveTags: new Set(["financial", "credential", "wallet"]),
  }
}

/**
 * Infer volatility classification from record tags.
 *
 * @zh 根据 tags 推断 volatility 分类。
 *
 * Rust reference: `infer_volatility` (`../src/trust.rs`).
 */
export function inferVolatility(tags: ReadonlyArray<string>, taxonomy: TagTaxonomy): string {
  const tagSet = new Set(tags)
  for (const tag of taxonomy.stableTags) {
    if (tagSet.has(tag)) return "stable"
  }
  for (const tag of taxonomy.volatileTags) {
    if (tagSet.has(tag)) return "volatile"
  }
  return "moderate"
}

/**
 * Get base provenance from a channel string.
 *
 * @zh 从 channel 推断 provenance。TS 侧 timestamp 由调用方通过 Clock 注入。
 *
 * Rust reference: `get_provenance` (`../src/trust.rs`).
 */
export function getProvenance(
  channel: string | undefined,
  trustConfig: TrustConfig,
  timestampIso: string,
): Provenance {
  const source =
    channel === "telegram" || channel === "desktop" || channel === "voice"
      ? `user-${channel}`
      : channel ?? "agent"
  const trustScore = trustConfig.source_trust[source] ?? 0.5
  return {
    source,
    verified: source.startsWith("user-"),
    trustScore,
    volatility: "moderate",
    timestamp: timestampIso,
  }
}

/**
 * Stamp provenance into record metadata.
 *
 * @zh 将 provenance 写入 record metadata；使用 `entry(...).or_insert(...)` 语义，
 * 不覆盖调用方显式提供的 metadata。
 *
 * Rust reference: `stamp_provenance` (`../src/trust.rs`).
 */
export function stampProvenance(
  metadata: Readonly<Record<string, string>>,
  channel: string | undefined,
  tags: ReadonlyArray<string>,
  taxonomy: TagTaxonomy,
  trustConfig: TrustConfig,
  timestampIso: string,
): Record<string, string> {
  const provenance = getProvenance(channel, trustConfig, timestampIso)
  return {
    source: provenance.source,
    verified: String(provenance.verified),
    trust_score: provenance.trustScore.toFixed(2),
    volatility: inferVolatility(tags, taxonomy),
    timestamp: provenance.timestamp,
    ...metadata,
  }
}
