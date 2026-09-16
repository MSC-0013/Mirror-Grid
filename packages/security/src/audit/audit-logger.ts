import { desc, gte, lte, and } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { auditLogs } from '@mirrorgrid/db/schema';
import type { UserPrincipal } from '../rbac/permissions.js';
import {
  GENESIS_HASH,
  computeRecordHash,
  verifyHashChain,
  type ChainVerificationResult,
  type VerifiableAuditRecord,
} from './hash-chain.js';

export interface AuditEntryInput {
  principal?: UserPrincipal | { id?: string; email?: string };
  action: string;
  resourceType: string;
  resourceId: string;
  diff?: {
    before?: unknown;
    after?: unknown;
    [key: string]: unknown;
  };
  clientIp?: string;
  userAgent?: string;
  timestamp?: Date;
}

export interface AuditRecord {
  id: string;
  seqNum: number;
  prevHash: string;
  recordHash: string;
  userId: string | null;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  diffJson: Record<string, unknown>;
  clientIp: string;
  userAgent: string | null;
  createdAt: Date;
}

export class AuditLogger {
  // Concurrency mutex lock to sequence concurrent audit writes
  private writeMutex: Promise<void> = Promise.resolve();

  public async log(entry: AuditEntryInput): Promise<AuditRecord> {
    // Acquire mutex to ensure sequential seqNum and hash chaining
    let releaseMutex: () => void = () => {};
    const waitPromise = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    const currentMutex = this.writeMutex;
    this.writeMutex = this.writeMutex.then(() => waitPromise);

    await currentMutex;

    try {
      // Find latest record for seq_num and prev_hash
      const [latest] = await db
        .select({
          seqNum: auditLogs.seqNum,
          recordHash: auditLogs.recordHash,
        })
        .from(auditLogs)
        .orderBy(desc(auditLogs.seqNum))
        .limit(1);

      const seqNum = latest ? latest.seqNum + 1 : 1;
      const prevHash = latest ? latest.recordHash : GENESIS_HASH;
      const createdAt = entry.timestamp ?? new Date();
      const userId = entry.principal?.id ?? null;
      const userEmail = entry.principal?.email ?? 'system@mirrorgrid.local';
      const diffJson = (entry.diff ?? {}) as Record<string, unknown>;

      const recordHash = computeRecordHash({
        prevHash,
        seqNum,
        timestamp: createdAt,
        userId: userId ?? '',
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        diff: diffJson,
      });

      const [inserted] = await db
        .insert(auditLogs)
        .values({
          seqNum,
          prevHash,
          recordHash,
          userId,
          userEmail,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          diffJson,
          clientIp: entry.clientIp ?? '127.0.0.1',
          userAgent: entry.userAgent ?? 'system',
          createdAt,
        })
        .returning();

      return inserted as AuditRecord;
    } finally {
      releaseMutex();
    }
  }

  public async verifyChain(fromSeq?: number, toSeq?: number): Promise<ChainVerificationResult> {
    const conditions = [];
    if (fromSeq !== undefined) {
      conditions.push(gte(auditLogs.seqNum, fromSeq));
    }
    if (toSeq !== undefined) {
      conditions.push(lte(auditLogs.seqNum, toSeq));
    }

    const query = db
      .select({
        seqNum: auditLogs.seqNum,
        prevHash: auditLogs.prevHash,
        recordHash: auditLogs.recordHash,
        userId: auditLogs.userId,
        userEmail: auditLogs.userEmail,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        diffJson: auditLogs.diffJson,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(auditLogs.seqNum);

    const records = (
      conditions.length > 0 ? await query.where(and(...conditions)) : await query
    ) as VerifiableAuditRecord[];

    return verifyHashChain(records);
  }
}

export const auditLogger = new AuditLogger();
