import { Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"
import type { CausalEngineState, CausalDiscoveryMode, TemporalBudgetMode, EvidenceMode } from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export class CausalStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): CausalStoreFile {
    return new CausalStoreFile(dir)
  }

  static empty_engine(): CausalEngineState {
    return {
      version: 1 as const,
      patterns: {},
      discovery_mode: "Standard" as CausalDiscoveryMode,
      edges_found_total: 0,
      temporal_budget_mode: "NearbySuccessors" as TemporalBudgetMode,
      evidence_mode: "StrictRepeatedWindows" as EvidenceMode,
      last_corpus_fingerprint: ""
    }
  }

  load(): Effect.Effect<CausalEngineState, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/causal.cog`
    return CogJsonSnapshotFile.load(filePath, CausalStoreFile.empty_engine)
  }

  save(engine: CausalEngineState): Effect.Effect<void, FileWriteError, FileWrite> {
    const filePath = `${this.dir}/causal.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
