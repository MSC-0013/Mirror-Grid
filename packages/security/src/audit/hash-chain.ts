import { createHash } from 'node:crypto';

export const GENESIS_HASH = 'GENESIS';

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj) ?? '';
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return '{' + pairs.join(',') + '}';
}

export function computePayloadHash(diff: unknown): string {
  const canonical = canonicalJson(diff ?? {});
  return createHash('sha256').update(canonical).digest('hex');
}

export interface RecordHashInput {
  prevHash: string;
  seqNum: number | bigint;
  timestamp: number | Date;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  diff: unknown;
}

export function computeRecordHash(input: RecordHashInput): string {
  const timeMs = input.timestamp instanceof Date ? input.timestamp.getTime() : input.timestamp;
  const payloadHash = computePayloadHash(input.diff);
  const data = [
    input.prevHash,
    input.seqNum.toString(),
    timeMs.toString(),
    input.userId,
    input.action,
    input.resourceType,
    input.resourceId,
    payloadHash,
  ].join('||');

  return createHash('sha256').update(data).digest('hex');
}

export interface VerifiableAuditRecord {
  seqNum: number;
  prevHash: string;
  recordHash: string;
  userId: string | null;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  diffJson: unknown;
  createdAt: Date | number;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalRecords: number;
  brokenSeq?: number;
  reason?: string;
}

export function verifyHashChain(
  records: readonly VerifiableAuditRecord[],
): ChainVerificationResult {
  if (records.length === 0) {
    return { valid: true, totalRecords: 0 };
  }

  // Sort ascending by seqNum
  const sorted = [...records].sort((a, b) => a.seqNum - b.seqNum);

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];

    if (i > 0) {
      const prev = sorted[i - 1];
      if (curr.seqNum !== prev.seqNum + 1) {
        return {
          valid: false,
          totalRecords: sorted.length,
          brokenSeq: curr.seqNum,
          reason: `Discontinuous sequence gap between ${prev.seqNum} and ${curr.seqNum}`,
        };
      }
      if (curr.prevHash !== prev.recordHash) {
        return {
          valid: false,
          totalRecords: sorted.length,
          brokenSeq: curr.seqNum,
          reason: `Previous hash mismatch at sequence #${curr.seqNum}: expected ${prev.recordHash}, got ${curr.prevHash}`,
        };
      }
    } else {
      if (curr.seqNum === 1 && curr.prevHash !== GENESIS_HASH) {
        return {
          valid: false,
          totalRecords: sorted.length,
          brokenSeq: 1,
          reason: `Genesis record seq 1 must have prevHash '${GENESIS_HASH}', got ${curr.prevHash}`,
        };
      }
    }

    const expectedHash = computeRecordHash({
      prevHash: curr.prevHash,
      seqNum: curr.seqNum,
      timestamp: curr.createdAt,
      userId: curr.userId ?? '',
      action: curr.action,
      resourceType: curr.resourceType,
      resourceId: curr.resourceId,
      diff: curr.diffJson,
    });

    if (curr.recordHash !== expectedHash) {
      return {
        valid: false,
        totalRecords: sorted.length,
        brokenSeq: curr.seqNum,
        reason: `Cryptographic record hash mismatch at sequence #${curr.seqNum}: expected ${expectedHash}, got ${curr.recordHash}`,
      };
    }
  }

  return { valid: true, totalRecords: sorted.length };
}
