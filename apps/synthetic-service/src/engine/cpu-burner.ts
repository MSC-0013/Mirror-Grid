import crypto from 'node:crypto';

/**
 * Consumes CPU cycles by computing iterative SHA-256 hashes for the requested milliseconds.
 */
export async function burnCpu(durationMs: number): Promise<void> {
  if (durationMs <= 0) return;

  const start = Date.now();
  let hash = crypto.randomBytes(32).toString('hex');

  while (Date.now() - start < durationMs) {
    hash = crypto.createHash('sha256').update(hash).digest('hex');
  }
}
