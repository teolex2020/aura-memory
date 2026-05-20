import * as fs from "node:fs"
import * as path from "node:path"
import { readBrainAuraFile, type BrainAuraRecord } from "../../storage/src/BrainAura"

export class Aura {
  private constructor(private readonly records: BrainAuraRecord[]) {}

  static async open(brainPath: string): Promise<Aura> {
    const brainAuraPath = path.join(brainPath, "brain.aura")
    const buf = new Uint8Array(fs.readFileSync(brainAuraPath))
    const parsed = readBrainAuraFile(buf)
    return new Aura(parsed.records)
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice()
  }
}
