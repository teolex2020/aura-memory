import { Effect } from "effect"
import { FileRead, FileWrite, UnimplementedError } from "@aura/contract"

export type BackupType = "Full" | "Incremental"

export type BackupHeader = {
  created_at: number
  created_at_iso: string
  source_path: string
  record_count: number
  original_size: number
  encrypted: boolean
  backup_type: BackupType
  parent_backup: string | null
  checksum: string
}

export class BackupManager {
  private constructor(private readonly sourceDir: string) {}

  static open(sourceDir: string): BackupManager {
    return new BackupManager(sourceDir)
  }

  createBackup(_outputPath: string): Effect.Effect<void, UnimplementedError, FileRead | FileWrite> {
    return Effect.fail(new UnimplementedError({ feature: "BackupManager.createBackup" }))
  }

  restore(_backupPath: string): Effect.Effect<void, UnimplementedError, FileWrite> {
    return Effect.fail(new UnimplementedError({ feature: "BackupManager.restore" }))
  }

  inspect(_backupPath: string): Effect.Effect<BackupHeader, UnimplementedError, FileRead> {
    return Effect.fail(new UnimplementedError({ feature: "BackupManager.inspect" }))
  }

  verify(_backupPath: string): Effect.Effect<void, UnimplementedError, FileRead> {
    return Effect.fail(new UnimplementedError({ feature: "BackupManager.verify" }))
  }
}
