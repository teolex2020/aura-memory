import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"

export type SnapshotId = string
export type SnapshotHash = string

export type Snapshot = {
  id: SnapshotId
  hash: SnapshotHash
  parent: SnapshotId | null
  timestamp: number
  timestamp_iso: string
  message: string
  branch: string
  record_count: number
  size_bytes: number
  tags: string[]
}

export type Branch = {
  name: string
  head: SnapshotId
  created_at: number
  updated_at: number
}

export type VersionedRecord = {
  id: string
  text: string
  timestamp: number
  layer: string
}

export type VersionIndex = {
  snapshots: Record<string, Snapshot>
  branches: Record<string, Branch>
  current_branch: string
}

const te = new TextEncoder()
const td = new TextDecoder()

function defaultIndex(): VersionIndex {
  return {
    snapshots: {},
    branches: {
      main: {
        name: "main",
        head: "",
        created_at: 0,
        updated_at: 0
      }
    },
    current_branch: "main"
  }
}

export class VersionManager {
  private constructor(
    private readonly versionsDir: string,
    private index: VersionIndex
  ) {}

  static open(storageDir: string): Effect.Effect<VersionManager, unknown, FileRead | FileWrite> {
    const versionsDir = `${storageDir}/versions`
    const indexPath = `${versionsDir}/index.json`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(versionsDir)

      let index = defaultIndex()
      const hasIndex = yield* fr.exists(indexPath)
      if (hasIndex) {
        const bytes = yield* fr.readFile(indexPath)
        index = JSON.parse(td.decode(bytes)) as VersionIndex
      }
      if (!index.branches) {
        index.branches = {}
      }
      if (!index.branches["main"]) {
        index.branches["main"] = {
          name: "main",
          head: "",
          created_at: 0,
          updated_at: 0
        }
      }
      if (!index.current_branch) {
        index.current_branch = "main"
      }

      return new VersionManager(versionsDir, index)
    })
  }

  getIndex(): VersionIndex {
    return this.index
  }

  saveIndex(): Effect.Effect<void, unknown, FileWrite> {
    const self = this
    const indexPath = `${this.versionsDir}/index.json`
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const bytes = te.encode(JSON.stringify(self.index, null, 2))
      yield* fw.writeFile(indexPath, bytes)
      yield* fw.fsync(indexPath)
    })
  }

  createSnapshot(_records: ReadonlyArray<VersionedRecord>, _message: string): Effect.Effect<Snapshot> {
    return Effect.die(new Error("TODO: implement versions snapshot format + hashing + delta"))
  }

  loadSnapshot(_id: SnapshotId): Effect.Effect<ReadonlyArray<VersionedRecord>> {
    return Effect.die(new Error("TODO: implement versions snapshot loading"))
  }
}
