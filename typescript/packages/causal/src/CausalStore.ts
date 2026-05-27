import { Layer } from "effect"
import { CausalStore } from "@aura/contract"
import type { CausalEngineState } from "@aura/contract"
import { CausalStoreFile } from "@aura/storage"

export class CausalStoreImpl {
  private readonly file: CausalStoreFile

  constructor(dir: string) {
    this.file = CausalStoreFile.new(dir)
  }

  load() {
    return this.file.load()
  }

  save(engine: CausalEngineState) {
    return this.file.save(engine)
  }
}

export function CausalStoreLive(dir: string) {
  return Layer.succeed(CausalStore, new CausalStoreImpl(dir))
}

