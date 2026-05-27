import { Layer } from "effect"
import { PolicyStore } from "@aura/contract"
import type { PolicyEngineState } from "@aura/contract"
import { PolicyStoreFile } from "@aura/storage"

export class PolicyStoreImpl {
  private readonly file: PolicyStoreFile

  constructor(dir: string) {
    this.file = PolicyStoreFile.new(dir)
  }

  load() {
    return this.file.load()
  }

  save(engine: PolicyEngineState) {
    return this.file.save(engine)
  }
}

export function PolicyStoreLive(dir: string) {
  return Layer.succeed(PolicyStore, new PolicyStoreImpl(dir))
}

