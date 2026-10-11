/** Small helpers for reading and writing big-endian binary data (MP4 boxes, WebM elements). */

export class TrimError extends Error {}

export function readU32(d: Uint8Array, o: number): number {
  return (
    ((d[o] ?? 0) * 0x1000000 +
      (((d[o + 1] ?? 0) << 16) | ((d[o + 2] ?? 0) << 8) | (d[o + 3] ?? 0))) >>>
    0
  );
}

export function readU16(d: Uint8Array, o: number): number {
  return ((d[o] ?? 0) << 8) | (d[o + 1] ?? 0);
}

export function readI32(d: Uint8Array, o: number): number {
  return readU32(d, o) | 0;
}

export function readU64(d: Uint8Array, o: number): number {
  return readU32(d, o) * 0x100000000 + readU32(d, o + 4);
}

export function readType(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o] ?? 0, d[o + 1] ?? 0, d[o + 2] ?? 0, d[o + 3] ?? 0);
}

/** Growable output buffer. */
export class Writer {
  private buf = new Uint8Array(1024);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u16(v: number): this {
    return this.u8(v >>> 8).u8(v);
  }

  u32(v: number): this {
    this.ensure(4);
    this.buf[this.length++] = (v >>> 24) & 0xff;
    this.buf[this.length++] = (v >>> 16) & 0xff;
    this.buf[this.length++] = (v >>> 8) & 0xff;
    this.buf[this.length++] = v & 0xff;
    return this;
  }

  u64(v: number): this {
    return this.u32(Math.floor(v / 0x100000000)).u32(v % 0x100000000);
  }

  f64(v: number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    return this.bytes(b);
  }

  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  /** Overwrites 4 bytes at an earlier position (e.g. a box size known only afterwards). */
  patchU32(at: number, v: number): void {
    this.buf[at] = (v >>> 24) & 0xff;
    this.buf[at + 1] = (v >>> 16) & 0xff;
    this.buf[at + 2] = (v >>> 8) & 0xff;
    this.buf[at + 3] = v & 0xff;
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
