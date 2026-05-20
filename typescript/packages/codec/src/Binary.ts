export class BinaryReader {
  private readonly view: DataView
  private readonly buf: Uint8Array
  private off = 0

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  remaining(): number {
    return this.buf.byteLength - this.off
  }

  private need(n: number): void {
    if (this.off + n > this.buf.byteLength) {
      throw new Error("unexpected eof")
    }
  }

  u8(): number {
    this.need(1)
    const v = this.view.getUint8(this.off)
    this.off += 1
    return v
  }

  u16le(): number {
    this.need(2)
    const v = this.view.getUint16(this.off, true)
    this.off += 2
    return v
  }

  u32le(): number {
    this.need(4)
    const v = this.view.getUint32(this.off, true)
    this.off += 4
    return v
  }

  u64leAsBigInt(): bigint {
    this.need(8)
    const lo = BigInt(this.view.getUint32(this.off, true))
    const hi = BigInt(this.view.getUint32(this.off + 4, true))
    this.off += 8
    return (hi << 32n) | lo
  }

  f32le(): number {
    this.need(4)
    const v = this.view.getFloat32(this.off, true)
    this.off += 4
    return v
  }

  f64le(): number {
    this.need(8)
    const v = this.view.getFloat64(this.off, true)
    this.off += 8
    return v
  }

  bytes(n: number): Uint8Array {
    this.need(n)
    const out = this.buf.subarray(this.off, this.off + n)
    this.off += n
    return out
  }

  sliceRemaining(): Uint8Array {
    return this.bytes(this.remaining())
  }
}

export class BinaryWriter {
  private chunks: Uint8Array[] = []
  private len = 0

  private push(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.len += chunk.byteLength
  }

  u8(v: number): void {
    const b = new Uint8Array(1)
    b[0] = v & 0xff
    this.push(b)
  }

  u16le(v: number): void {
    const b = new Uint8Array(2)
    const view = new DataView(b.buffer)
    view.setUint16(0, v & 0xffff, true)
    this.push(b)
  }

  u32le(v: number): void {
    const b = new Uint8Array(4)
    const view = new DataView(b.buffer)
    view.setUint32(0, v >>> 0, true)
    this.push(b)
  }

  u64leFromBigInt(v: bigint): void {
    const b = new Uint8Array(8)
    const view = new DataView(b.buffer)
    view.setUint32(0, Number(v & 0xffffffffn), true)
    view.setUint32(4, Number((v >> 32n) & 0xffffffffn), true)
    this.push(b)
  }

  f32le(v: number): void {
    const b = new Uint8Array(4)
    const view = new DataView(b.buffer)
    view.setFloat32(0, v, true)
    this.push(b)
  }

  f64le(v: number): void {
    const b = new Uint8Array(8)
    const view = new DataView(b.buffer)
    view.setFloat64(0, v, true)
    this.push(b)
  }

  bytes(buf: Uint8Array): void {
    this.push(buf)
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.len)
    let off = 0
    for (const c of this.chunks) {
      out.set(c, off)
      off += c.byteLength
    }
    return out
  }
}
