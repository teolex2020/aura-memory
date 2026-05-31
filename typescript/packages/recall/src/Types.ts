import type { BoundedRerankModes } from "@aura/contract"

export type RankedList = Array<readonly [recordId: string, rawScore: number]>

export type Scored = Array<readonly [score: number, recordId: string]>

export type RecallPipelineOptions = {
  topK: number
  minStrength: number
  expandConnections: boolean
  namespaces: ReadonlyArray<string>
  sessionId: string | undefined
  boundedRerankModes: Partial<BoundedRerankModes> | undefined
}

export type RecallRecord = {
  id: string
  tags?: ReadonlyArray<string>
  connections?: Record<string, number>
  caused_by_id?: string | null
  strength?: number
  namespace?: string
  metadata?: Record<string, string>
  source_type?: string
}
