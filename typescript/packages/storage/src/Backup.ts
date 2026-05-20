import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"

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

  createBackup(_outputPath: string): Effect.Effect<void, unknown, FileRead | FileWrite> {
    return Effect.die(new Error("TODO: implement .aura.bak compatible backup format"))
  }

  restore(_backupPath: string): Effect.Effect<void, unknown, FileWrite> {
    return Effect.die(new Error("TODO: implement .aura.bak restore"))
  }

  inspect(_backupPath: string): Effect.Effect<BackupHeader, unknown, FileRead> {
    return Effect.die(new Error("TODO: implement .aura.bak header inspection"))
  }

  verify(_backupPath: string): Effect.Effect<void, unknown, FileRead> {
    return Effect.die(new Error("TODO: implement .aura.bak integrity verification"))
  }
}

