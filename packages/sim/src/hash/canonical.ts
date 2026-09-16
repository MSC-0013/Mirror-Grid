/**
 * Canonical binary serializer for the state hash preimage.
 *
 * Why not JSON: key order is only conventionally stable, number formatting is lossy,
 * and `undefined` / `-0` are ambiguous. None of that is acceptable when the output is
 * hashed and compared for equality across runs.
 *
 * Rules enforced here:
 *   - Every field is length-prefixed, so ("ab","c") and ("a","bc") cannot collide.
 *   - Every field carries a type tag, so a schema mismatch fails loudly rather than
 *     producing a plausible-but-wrong hash.
 *   - Map keys are sorted by raw UTF-8 bytes, never by `localeCompare` — locale-dependent
 *     collation is a classic cross-platform determinism bug.
 *   - Floats cannot be written at all. See `float()`.
 */

const enum Tag {
  U8 = 0x01,
  U32 = 0x02,
  U64 = 0x03,
  I64 = 0x04,
  BOOL = 0x05,
  STR = 0x06,
  BYTES = 0x07,
  ARRAY = 0x08,
  MAP = 0x09,
  NULL = 0x0a,
  PRESENT = 0x0b,
}

const MASK_64 = 0xffffffffffffffffn;

export class CanonicalSerializer {
  private readonly chunks: Buffer[] = [];
  private length = 0;

  private push(buf: Buffer): this {
    this.chunks.push(buf);
    this.length += buf.length;
    return this;
  }

  private tag(tag: Tag): this {
    return this.push(Buffer.from([tag]));
  }

  get byteLength(): number {
    return this.length;
  }

  u8(value: number): this {
    this.tag(Tag.U8);
    return this.push(Buffer.from([value & 0xff]));
  }

  u32(value: number): this {
    this.tag(Tag.U32);
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(value >>> 0, 0);
    return this.push(buf);
  }

  u64(value: bigint): this {
    this.tag(Tag.U64);
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(value & MASK_64, 0);
    return this.push(buf);
  }

  i64(value: bigint): this {
    this.tag(Tag.I64);
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64LE(BigInt.asIntN(64, value), 0);
    return this.push(buf);
  }

  bool(value: boolean): this {
    this.tag(Tag.BOOL);
    return this.push(Buffer.from([value ? 0x01 : 0x00]));
  }

  str(value: string): this {
    this.tag(Tag.STR);
    const bytes = Buffer.from(value, 'utf8');
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(bytes.length, 0);
    return this.push(len).push(bytes);
  }

  bytes(value: Uint8Array): this {
    this.tag(Tag.BYTES);
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(value.length, 0);
    return this.push(len).push(Buffer.from(value));
  }

  /**
   * Integer-only. Any float that must cross this boundary is quantized ONCE at the config
   * boundary — never here. Quantizing at hash time would let an un-quantized float
   * influence a branch and diverge the run long before anything is hashed.
   */
  intArray(values: ArrayLike<number>): this {
    this.tag(Tag.ARRAY);
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(values.length, 0);
    this.push(len);
    const body = Buffer.allocUnsafe(values.length * 4);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isInteger(v)) {
        throw new TypeError(
          `CanonicalSerializer.intArray received a non-integer at index ${i}: ${v}`
        );
      }
      body.writeInt32LE(v, i * 4);
    }
    return this.push(body);
  }

  array<T>(values: readonly T[], write: (s: CanonicalSerializer, value: T) => void): this {
    this.tag(Tag.ARRAY);
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(values.length, 0);
    this.push(len);
    for (const value of values) {
      write(this, value);
    }
    return this;
  }

  /** Entries are emitted in UTF-8 byte order regardless of insertion order. */
  sortedMap<V>(
    entries: ReadonlyMap<string, V> | Record<string, V>,
    write: (s: CanonicalSerializer, value: V) => void
  ): this {
    const pairs: Array<[string, V]> =
      entries instanceof Map ? Array.from(entries.entries()) : Object.entries(entries);

    pairs.sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));

    this.tag(Tag.MAP);
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(pairs.length, 0);
    this.push(len);

    for (const [key, value] of pairs) {
      this.str(key);
      write(this, value);
    }
    return this;
  }

  optional<T>(
    value: T | undefined | null,
    write: (s: CanonicalSerializer, value: T) => void
  ): this {
    if (value === undefined || value === null) {
      return this.tag(Tag.NULL);
    }
    this.tag(Tag.PRESENT);
    write(this, value);
    return this;
  }

  /**
   * Writing a float is a COMPILE ERROR.
   *
   * `never` means no value can be passed: `s.float(1.5)` fails typecheck. This is the
   * type-level guarantee that IEEE-754 rounding differences between engines cannot reach
   * the state hash. Quantize to an integer at the config boundary instead.
   *
   * @deprecated Not callable by design — quantize to an integer and use u64/i64/intArray.
   */
  float(_value: never): never {
    throw new TypeError(
      'CanonicalSerializer.float() is unreachable by design: quantize floats to integers ' +
        'at the configuration boundary before they can influence simulation state.'
    );
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.length);
  }
}
