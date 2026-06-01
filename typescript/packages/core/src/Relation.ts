import { Effect } from "effect"
import { Level, Record as AuraRecord, RecordValidationError, type RelationEdge } from "@aura/contract"
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

/**
 * Minimum explicit link weight that is promoted from record links to entity anchors.
 *
 * @zh 显式 record link 晋升到 entity anchor link 的最小权重。
 *
 * Rust reference: `ENTITY_RELATION_PROMOTION_MIN_WEIGHT` (`../src/aura.rs`).
 */
export const ENTITY_RELATION_PROMOTION_MIN_WEIGHT = 0.8

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
 * Result of creating one explicit typed relation.
 *
 * @zh 创建一条显式 typed relation 的结果。
 *
 * Rust reference: `Aura::link_records` (`../src/aura.rs`).
 */
export interface LinkRecordsResult {
  readonly edge: RelationEdge
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
 * Create a deterministic explicit typed relation between two existing records.
 *
 * @zh 在两条已存在 records 之间创建确定性的显式 typed relation。
 *
 * Rust reference: `Aura::link_records` (`../src/aura.rs`).
 */
export function linkRecords(
  records: ReadonlyMap<string, AuraRecord>,
  sourceId: string,
  targetId: string,
  relationType: string,
  weight?: number,
): Effect.Effect<LinkRecordsResult, RecordValidationError> {
  return Effect.gen(function* () {
    if (sourceId === targetId) {
      return yield* Effect.fail(relationValidationError(
        "target_id",
        "Cannot link record to itself",
        "Aura::link_records (aura.rs)",
      ))
    }
    if (relationType.trim().length === 0) {
      return yield* Effect.fail(relationValidationError(
        "relation_type",
        "Relation type must not be empty",
        "Aura::link_records (aura.rs)",
      ))
    }

    const source = records.get(sourceId)
    if (source === undefined) {
      return yield* Effect.fail(relationValidationError(
        "source_id",
        `Source record ${sourceId} not found`,
        "Aura::link_records (aura.rs)",
      ))
    }
    const target = records.get(targetId)
    if (target === undefined) {
      return yield* Effect.fail(relationValidationError(
        "target_id",
        `Target record ${targetId} not found`,
        "Aura::link_records (aura.rs)",
      ))
    }
    if (source.namespace !== target.namespace) {
      return yield* Effect.fail(relationValidationError(
        "namespace",
        `Cannot link records across namespaces: ${source.namespace} vs ${target.namespace}`,
        "Aura::link_records (aura.rs)",
      ))
    }

    const clampedWeight = clampRelationWeight(weight ?? 0.8)
    const next = new Map(records)
    const changedById = new Map<string, AuraRecord>()

    upsertStructuralConnection(next, changedById, sourceId, targetId, clampedWeight, relationType)
    upsertStructuralConnection(next, changedById, targetId, sourceId, clampedWeight, relationType)
    promoteRecordLinkToEntityAnchors(next, changedById, sourceId, targetId, relationType, clampedWeight)

    return {
      edge: {
        source_record_id: sourceId,
        target_record_id: targetId,
        relation_type: relationType,
        weight: clampedWeight,
        namespace: source.namespace,
        structural: isStructuralRelationType(relationType),
      },
      records: next,
      changed_records: Array.from(changedById.values()),
    }
  })
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
    if (upsertStructuralConnection(records, changedById, profileId, recordId, STRUCTURAL_FAMILY_WEIGHT, relationType)) {
      phaseChangedIds.add(profileId)
    }
    if (upsertStructuralConnection(records, changedById, recordId, profileId, STRUCTURAL_FAMILY_WEIGHT, relationType)) {
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
    if (upsertStructuralConnection(
      records,
      changedById,
      projectId,
      reportId,
      STRUCTURAL_PROJECT_WEIGHT,
      PROJECT_MEMBERSHIP_RELATION,
    )) {
      phaseChangedIds.add(projectId)
    }
    if (upsertStructuralConnection(
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

function promoteRecordLinkToEntityAnchors(
  records: Map<string, AuraRecord>,
  changedById: Map<string, AuraRecord>,
  sourceId: string,
  targetId: string,
  relationType: string,
  weight: number,
): void {
  if (weight < ENTITY_RELATION_PROMOTION_MIN_WEIGHT) return
  const sourceEntityId = records.get(sourceId)?.metadata.entity_id
  const targetEntityId = records.get(targetId)?.metadata.entity_id
  if (sourceEntityId === undefined || targetEntityId === undefined || sourceEntityId === targetEntityId) {
    return
  }
  const sourceAnchor = selectEntityAnchorRecord(records, sourceEntityId)
  const targetAnchor = selectEntityAnchorRecord(records, targetEntityId)
  if (sourceAnchor === undefined || targetAnchor === undefined) return

  upsertStructuralConnection(records, changedById, sourceAnchor.id, targetAnchor.id, weight, relationType)
  upsertStructuralConnection(records, changedById, targetAnchor.id, sourceAnchor.id, weight, relationType)
}

function selectEntityAnchorRecord(
  records: ReadonlyMap<string, AuraRecord>,
  entityId: string,
): AuraRecord | undefined {
  let namespace: string | undefined
  const scoped: AuraRecord[] = []
  for (const record of records.values()) {
    if (record.metadata.entity_id !== entityId) continue
    if (namespace === undefined) namespace = record.namespace
    if (namespace !== record.namespace) continue
    scoped.push(record)
  }
  scoped.sort((a, b) => {
    const projectDelta = Number(b.tags.includes("research-project")) - Number(a.tags.includes("research-project"))
    if (projectDelta !== 0) return projectDelta
    const profileDelta = Number(b.tags.includes(Identity.PROFILE_TAG)) - Number(a.tags.includes(Identity.PROFILE_TAG))
    if (profileDelta !== 0) return profileDelta
    const levelDelta = Level.value(b.level) - Level.value(a.level)
    if (levelDelta !== 0) return levelDelta
    const createdDelta = a.created_at - b.created_at
    if (createdDelta !== 0) return createdDelta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return scoped[0]
}

function upsertStructuralConnection(
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

function clampRelationWeight(weight: number): number {
  return Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0.8
}

function relationValidationError(field: string, message: string, rustReference: string): RecordValidationError {
  return new RecordValidationError({
    field,
    message,
    rustReference,
  })
}
