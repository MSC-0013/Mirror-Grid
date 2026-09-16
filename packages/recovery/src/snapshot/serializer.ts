import crypto from 'node:crypto';

/**
 * Deterministically serializes any JavaScript object or primitive into a canonical string.
 * Recursively sorts all dictionary keys to guarantee that identical object contents
 * produce identical serialized strings across any runtime environment or execution order.
 */
export function canonicalStringify(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }

  if (typeof val === 'bigint') {
    return val.toString();
  }

  if (typeof val === 'number') {
    if (Object.is(val, -0)) return '-0';
    if (!Number.isFinite(val)) return 'null';
    return val.toString();
  }

  if (typeof val === 'boolean' || typeof val === 'string') {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    const items = val.map((item) => canonicalStringify(item));
    return `[${items.join(',')}]`;
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    const pairs = keys.map((key) => {
      const v = (val as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${canonicalStringify(v)}`;
    });
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(val);
}

/**
 * Computes a standard SHA-256 hex digest for a string payload.
 */
export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
