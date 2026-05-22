export type RelationEdge = {
  id: string
  from: string
  to: string
  weight: number
  kind: string
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

