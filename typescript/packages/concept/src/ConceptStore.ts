import { Layer } from "effect"
import { type ConceptEngineState, ConceptStore } from "@aura/contract"
import { ConceptStoreFile } from "@aura/storage"

export class ConceptStoreImpl {
  private readonly file: ConceptStoreFile

  constructor(dir: string) {
    this.file = ConceptStoreFile.new(dir)
  }

  load() {
    return this.file.load()
  }

  save(engine: ConceptEngineState) {
    return this.file.save(engine)
  }
}

export function ConceptStoreLive(dir: string) {
  return Layer.succeed(ConceptStore, new ConceptStoreImpl(dir))
}
