import { Effect } from "effect"
import { Record as AuraRecord } from "@aura/contract"
import * as Identity from "./Identity"

/**
 * Strong deterministic weight for explicit family relations.
 *
 * @zh 显式 family 结构关系使用的确定性强权重。
 *
 * Rust reference: `STRUCTURAL_FAMILY_WEIGHT` (`../src/relation.rs`).
 */
export const STRUCTURAL_FAMILY_WEIGHT = 0.95

/**
 * Strong deterministic weight for explicit project membership relations.
 *
 * @zh 显式 project membership 结构关系使用的确定性强权重。
 *
 * Rust reference: `STRUCTURAL_PROJECT_WEIGHT` (`../src/relation.rs`).
 */
export const STRUCTURAL_PROJECT_WEIGHT = 0.92

/**
 * Deterministic project membership relation type.
 *
 * @zh 确定性 project membership 关系类型。
 *
 * Rust reference: `PROJECT_MEMBERSHIP_RELATION` (`../src/relation.rs`).
 */
export const PROJECT_MEMBERSHIP_RELATION = "belongs_to_project"

const FAMILY_PATTERNS: ReadonlyArray<readonly [pattern: string, relation_type: string]> = [
  ["my brother", "family.brother"],
  ["my sister", "family.sister"],
  ["my mother", "family.mother"],
  ["my father", "family.father"],
  ["my mom", "family.mother"],
  ["my dad", "family.father"],
  ["my wife", "family.wife"],
  ["my husband", "family.husband"],
  ["my son", "family.son"],
  ["my daughter", "family.daughter"],
  ["my grandmother", "family.grandmother"],
  ["my grandfather", "family.grandfather"],
]

/**
 * Result of refreshing deterministic relations inside one namespace.
 *
 * @zh 刷新一个 namespace 内 deterministic relations 的结果。
 *
 * Rust reference: `refresh_deterministic_relations_for_namespace` (`../src/aura.rs`).
 */
export interface DeterministicRelationRefreshResult {
  readonly changed_count: number
  readonly records: Map<string, AuraRecord>
  readonly changed_records: ReadonlyArray<AuraRecord>
}

/**
 * Normalize free text into a lowercase alphanumeric corridor.
 *
 * @zh 将自由文本归一化为小写字母数字 corridor，两端保留空格以匹配 Rust contains 语义。
 *
 * Rust reference: `normalize_relation_text` (`../src/relation.rs`).
 */
export function normalizeRelationText(text: string): string {
  let normalized = " "
  let lastWasSpace = true
  for (const char of text.toLowerCase()) {
    if (/^[a-z0-9]$/.test(char)) {
      normalized += char
      lastWasSpace = false
    } else if (!lastWasSpace) {
      normalized += " "
      lastWasSpace = true
    }
  }
  if (!lastWasSpace) normalized += " "
  return normalized
}

/**
 * Detect a deterministic family relation from record content.
 *
 * @zh 从 record content 中检测确定性 family relation。
 *
 * Rust reference: `detect_family_relation` (`../src/relation.rs`).
 */
export function detectFamilyRelation(content: string): string | null {
  const normalized = normalizeRelationText(content)
  for (const [pattern, relation_type] of FAMILY_PATTERNS) {
    if (normalized.includes(pattern)) return relation_type
  }
  return null
}

/**
 * Family relations use the `family.*` typed structural corridor.
 *
 * @zh family relation 使用 `family.*` typed structural corridor。
 *
 * Rust reference: `is_family_relation_type` (`../src/relation.rs`).
 */
export function isFamilyRelationType(relationType: string): boolean {
  return relationType.startsWith("family.")
}

/**
 * Structural relations are explicit non-semantic graph edges.
 *
 * @zh structural relation 是显式的非语义 graph edge。
 *
 * Rust reference: `is_structural_relation_type` (`../src/relation.rs`).
 */
export function isStructuralRelationType(relationType: string): boolean {
  return isFamilyRelationType(relationType) || relationType === PROJECT_MEMBERSHIP_RELATION
}

/**
 * Refresh deterministic family and project relations for a namespace.
 *
 * @zh 刷新一个 namespace 内的 deterministic family 与 project membership 关系。
 *
 * Rust reference: `refresh_deterministic_relations_for_namespace` (`../src/aura.rs`).
 */
export function refreshDeterministicRelationsForNamespace(
  records: ReadonlyMap<string, AuraRecord>,
  namespace: string,
): Effect.Effect<DeterministicRelationRefreshResult> {
  return Effect.sync(() => {
    const next = new Map(records)
    const changedById = new Map<string, AuraRecord>()
    let changedCount = 0

    changedCount += refreshFamilyRelationsForNamespace(next, changedById, namespace)
    changedCount += refreshProjectMembershipRelationsForNamespace(next, changedById, namespace)

    return {
      changed_count: changedCount,
      records: next,
      changed_records: Array.from(changedById.values()),
    }
  })
}

function refreshFamilyRelationsForNamespace(
  records: Map<string, AuraRecord>,
  changedById: Map<string, AuraRecord>,
  namespace: string,
): number {
  const profileId = Array.from(records.values()).find((record) =>
    record.namespace === namespace && record.tags.includes(Identity.PROFILE_TAG)
  )?.id
  if (profileId === undefined) return 0

  const relationTargets: Array<readonly [record_id: string, relation_type: string]> = []
  for (const record of records.values()) {
    if (record.namespace !== namespace || record.id === profileId) continue
    const metadataRelation = record.metadata.family_relation
    const relationType =
      metadataRelation !== undefined && isFamilyRelationType(metadataRelation)
        ? metadataRelation
        : detectFamilyRelation(record.content)
    if (relationType !== null) relationTargets.push([record.id, relationType])
  }

  const phaseChangedIds = new Set<string>()
  for (const [recordId, relationType] of relationTargets) {
    if (upsertRecordConnection(records, changedById, profileId, recordId, STRUCTURAL_FAMILY_WEIGHT, relationType)) {
      phaseChangedIds.add(profileId)
    }
    if (upsertRecordConnection(records, changedById, recordId, profileId, STRUCTURAL_FAMILY_WEIGHT, relationType)) {
      phaseChangedIds.add(recordId)
    }
  }
  return phaseChangedIds.size
}

function refreshProjectMembershipRelationsForNamespace(
  records: Map<string, AuraRecord>,
  changedById: Map<string, AuraRecord>,
  namespace: string,
): number {
  const projectAnchors = new Map<string, string>()
  for (const record of records.values()) {
    if (record.namespace !== namespace) continue
    if (!record.tags.includes("research-project")) continue
    const projectId = record.metadata.project_id
    if (projectId !== undefined) projectAnchors.set(projectId, record.id)
  }
  if (projectAnchors.size === 0) return 0

  const relationTargets: Array<readonly [report_id: string, project_record_id: string]> = []
  for (const record of records.values()) {
    if (record.namespace !== namespace) continue
    if (record.tags.includes("research-project")) continue
    const projectId = record.metadata.project_id
    if (projectId === undefined) continue
    const anchorId = projectAnchors.get(projectId)
    if (anchorId !== undefined) relationTargets.push([record.id, anchorId])
  }

  const phaseChangedIds = new Set<string>()
  for (const [reportId, projectId] of relationTargets) {
    if (upsertRecordConnection(
      records,
      changedById,
      projectId,
      reportId,
      STRUCTURAL_PROJECT_WEIGHT,
      PROJECT_MEMBERSHIP_RELATION,
    )) {
      phaseChangedIds.add(projectId)
    }
    if (upsertRecordConnection(
      records,
      changedById,
      reportId,
      projectId,
      STRUCTURAL_PROJECT_WEIGHT,
      PROJECT_MEMBERSHIP_RELATION,
    )) {
      phaseChangedIds.add(reportId)
    }
  }
  return phaseChangedIds.size
}

function upsertRecordConnection(
  records: Map<string, AuraRecord>,
  changedById: Map<string, AuraRecord>,
  recordId: string,
  otherId: string,
  weight: number,
  relationType: string,
): boolean {
  const record = records.get(recordId)
  if (record === undefined) return false
  if (record.connections[otherId] === weight && AuraRecord.connectionType(record, otherId) === relationType) {
    return false
  }
  const updated = AuraRecord.addTypedConnection(record, otherId, weight, relationType)
  records.set(recordId, updated)
  changedById.set(recordId, updated)
  return true
}
