import { Layer } from "effect"
import { BeliefStore } from "@aura/contract"
import { BeliefStoreFile } from "@aura/storage"

export class BeliefStoreImpl {
  private readonly file: BeliefStoreFile

  constructor(dir: string) {
    this.file = BeliefStoreFile.new(dir)
  }

  load() {
    return this.file.load()
  }

  save(engine: unknown) {
    return this.file.save(engine)
  }
}

export function BeliefStoreLive(dir: string) {
  return Layer.succeed(BeliefStore, new BeliefStoreImpl(dir))
}

