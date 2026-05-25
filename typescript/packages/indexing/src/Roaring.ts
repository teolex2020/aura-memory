import { RoaringBitmap32 } from "roaring-wasm"

export class RoaringBitmap {
  private constructor(private readonly inner: RoaringBitmap32) {}

  static empty(): RoaringBitmap {
    return new RoaringBitmap(new RoaringBitmap32())
  }

  static deserialize(bytes: Uint8Array): RoaringBitmap {
    return new RoaringBitmap(RoaringBitmap32.deserialize("portable", bytes))
  }

  serialize(): Uint8Array {
    return this.inner.serialize("portable")
  }

  add(v: number): void {
    this.inner.add(v >>> 0)
  }

  remove(v: number): void {
    this.inner.remove(v >>> 0)
  }

  has(v: number): boolean {
    return this.inner.has(v >>> 0)
  }

  and(other: RoaringBitmap): RoaringBitmap {
    return new RoaringBitmap(RoaringBitmap32.and(this.inner, other.inner))
  }

  or(other: RoaringBitmap): RoaringBitmap {
    return new RoaringBitmap(RoaringBitmap32.or(this.inner, other.inner))
  }

  toArray(): number[] {
    return this.inner.toArray()
  }

  get size(): number {
    return this.inner.size
  }
}
