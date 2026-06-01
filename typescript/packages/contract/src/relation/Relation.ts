/**
 * Public inspect shape for any explicit typed relation edge.
 *
 * @zh 显式 typed relation edge 的公开检查结构。
 *
 * Rust reference: `RelationEdge` (`../src/relation.rs`).
 */
export interface RelationEdge {
  readonly source_record_id: string
  readonly target_record_id: string
  readonly relation_type: string
  readonly weight: number
  readonly namespace: string
  readonly structural: boolean
}

export type EntityDigest = {
  entity_id: string
  label: string
  kind: string
  record_ids: ReadonlyArray<string>
}

export type ProjectDigest = {
  project_id: string
  title: string
  status: string
}

export type FamilyGraphSnapshot = {
  namespace: string
  members: ReadonlyArray<string>
}
