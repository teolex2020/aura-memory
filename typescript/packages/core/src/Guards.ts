import type { TagTaxonomy } from "./Trust"

const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{2,4}/
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
const WALLET_RE = /(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|T[a-zA-Z0-9]{33})/
const API_KEY_RE = /(?:sk-|api[_-]?key|token|secret)[:\s=]+[A-Za-z0-9_-]{20,}/
const PASSWORD_RE = /(?:password|passwd|пароль)[:\s=]+\S+/i

/**
 * Result of running store guards.
 *
 * @zh store guard 执行结果；对齐 Rust `GuardResult`。
 *
 * Rust reference: `GuardResult` (`../src/guards.rs`).
 */
export type GuardResult = {
  readonly extra_tags: ReadonlyArray<string>
  readonly extra_metadata: ReadonlyArray<readonly [string, string]>
  readonly needs_approval: boolean
}

/**
 * Auto-add protective tags to content containing sensitive values.
 *
 * @zh 对含敏感值的内容自动补保护 tag，避免 consolidation 丢失具体值。
 *
 * Rust reference: `auto_protect_tags` (`../src/guards.rs`).
 */
export function autoProtectTags(content: string, tags: ReadonlyArray<string>): string[] {
  const out = [...tags]
  const add = (tag: string): void => {
    if (!out.includes(tag)) out.push(tag)
  }
  if (PHONE_RE.test(content)) add("contact")
  if (EMAIL_RE.test(content)) add("contact")
  if (WALLET_RE.test(content)) add("financial")
  if (PASSWORD_RE.test(content) || API_KEY_RE.test(content)) add("credential")
  return out
}

/**
 * Apply store guard to sensitive data.
 *
 * @zh 检测敏感 tag/content，并根据交互式 channel 设置 actionable metadata。
 *
 * Rust reference: `apply_store_guard` (`../src/guards.rs`).
 */
export function applyStoreGuard(
  content: string,
  tags: ReadonlyArray<string>,
  channel: string | undefined,
  taxonomy: TagTaxonomy,
): GuardResult {
  const isInteractive = channel === "desktop" || channel === "telegram" || channel === "voice"
  const tagSet = new Set(tags)
  const hasSensitiveTags = [...taxonomy.sensitive_tags].some((tag) => tagSet.has(tag))
  const hasSensitiveContent =
    EMAIL_RE.test(content) || WALLET_RE.test(content) || API_KEY_RE.test(content) || PASSWORD_RE.test(content)

  if (!hasSensitiveTags && !hasSensitiveContent) {
    return { extra_tags: [], extra_metadata: [], needs_approval: false }
  }

  if (isInteractive) {
    return { extra_tags: [], extra_metadata: [["actionable", "true"]], needs_approval: false }
  }

  return {
    extra_tags: [],
    extra_metadata: [["actionable", "false"]],
    needs_approval: hasSensitiveTags,
  }
}

/**
 * Check if content should be skipped from consolidation based on its tags.
 *
 * @zh 根据 tags 判断是否跳过 consolidation。
 *
 * Rust reference: `should_skip_consolidation` (`../src/guards.rs`).
 */
export function shouldSkipConsolidation(tags: ReadonlyArray<string>, taxonomy: TagTaxonomy): boolean {
  const tagSet = new Set(tags)
  return [...taxonomy.consolidation_skip_tags].some((tag) => tagSet.has(tag))
}

/**
 * Check if a record is protected from archival.
 *
 * @zh 判断 record 是否受 archive 保护。
 *
 * Rust reference: `is_archive_protected` (`../src/guards.rs`).
 */
export function isArchiveProtected(tags: ReadonlyArray<string>, taxonomy: TagTaxonomy): boolean {
  const tagSet = new Set(tags)
  return [...taxonomy.archive_protected_tags].some((tag) => tagSet.has(tag))
}
