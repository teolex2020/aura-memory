import type { Level } from "../levels/Level"

export type RecordId = string

export type Record = {
  id: RecordId
  content: string
  level: Level
  strength: number
  activation_count: number
  created_at: number
  last_activated: number
  tags: ReadonlyArray<string>
  connections: { readonly [recordId: string]: number }
  content_type: string
  source_type: string
  namespace: string
  semantic_type: string
  metadata: { readonly [k: string]: string }
  aura_id?: string | null
  caused_by_id?: string | null
  confidence?: number
  support_mass?: number
  conflict_mass?: number
}

export type StoreOptions = {
  level?: Level
  tags?: ReadonlyArray<string>
  pin?: boolean
  content_type?: string
  source_type?: string
  metadata?: { readonly [k: string]: string }
  deduplicate?: boolean
  caused_by_id?: string
  namespace?: string
  semantic_type?: string
}

export type UpdateOptions = {
  tags?: ReadonlyArray<string>
  metadata?: { readonly [k: string]: string }
  content?: string
  strength?: number
}
