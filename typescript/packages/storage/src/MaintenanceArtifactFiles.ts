import { Effect } from "effect"
import {
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  JsonParseError,
  type McpMaintenanceTrendSnapshot,
  type McpReflectionSummary
} from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export const MAINTENANCE_TRENDS_FILE = "maintenance_trends.json"
export const REFLECTION_SUMMARIES_FILE = "reflection_summaries.json"

/**
 * File helper for Rust `maintenance_trends.json`.
 *
 * Rust reference: `../src/aura.rs::load_maintenance_trends_with_validation`
 * and `save_maintenance_trends`.
 */
export class MaintenanceTrendsFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): MaintenanceTrendsFile {
    return new MaintenanceTrendsFile(dir)
  }

  static empty(): ReadonlyArray<McpMaintenanceTrendSnapshot> {
    return []
  }

  load(): Effect.Effect<ReadonlyArray<McpMaintenanceTrendSnapshot>, FileReadError | JsonParseError, FileRead> {
    return CogJsonSnapshotFile.load(`${this.dir}/${MAINTENANCE_TRENDS_FILE}`, MaintenanceTrendsFile.empty)
  }

  save(history: ReadonlyArray<McpMaintenanceTrendSnapshot>): Effect.Effect<void, FileWriteError, FileWrite> {
    const filePath = `${this.dir}/${MAINTENANCE_TRENDS_FILE}`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, history)
    })
  }
}

/**
 * File helper for Rust `reflection_summaries.json`.
 *
 * Rust reference: `../src/aura.rs::load_reflection_summaries_with_validation`
 * and `save_reflection_summaries`.
 */
export class ReflectionSummariesFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): ReflectionSummariesFile {
    return new ReflectionSummariesFile(dir)
  }

  static empty(): ReadonlyArray<McpReflectionSummary> {
    return []
  }

  load(): Effect.Effect<ReadonlyArray<McpReflectionSummary>, FileReadError | JsonParseError, FileRead> {
    return CogJsonSnapshotFile.load(`${this.dir}/${REFLECTION_SUMMARIES_FILE}`, ReflectionSummariesFile.empty)
  }

  save(history: ReadonlyArray<McpReflectionSummary>): Effect.Effect<void, FileWriteError, FileWrite> {
    const filePath = `${this.dir}/${REFLECTION_SUMMARIES_FILE}`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, history)
    })
  }
}
