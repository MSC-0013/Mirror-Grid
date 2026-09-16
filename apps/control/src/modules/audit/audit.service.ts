import { eq, and, count, desc } from 'drizzle-orm';
import { db } from '@mirrorgrid/db';
import { auditLogs } from '@mirrorgrid/db/schema';
import { auditLogger } from '@mirrorgrid/security';

export interface AuditQueryOptions {
  page?: number;
  limit?: number;
  resourceType?: string;
  action?: string;
  userId?: string;
}

export class AuditService {
  public async list(options: AuditQueryOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (options.resourceType) {
      conditions.push(eq(auditLogs.resourceType, options.resourceType));
    }
    if (options.action) {
      conditions.push(eq(auditLogs.action, options.action));
    }
    if (options.userId) {
      conditions.push(eq(auditLogs.userId, options.userId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db.select({ count: count() }).from(auditLogs).where(whereClause);

    const total = totalRow ? Number(totalRow.count) : 0;

    const records = await db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.seqNum))
      .limit(limit)
      .offset(offset);

    // Quick chain verification summary
    const verification = await auditLogger.verifyChain();

    return {
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      chainValid: verification.valid,
      brokenSeq: verification.brokenSeq,
    };
  }

  public async verifyChain(fromSeq?: number, toSeq?: number) {
    return auditLogger.verifyChain(fromSeq, toSeq);
  }
}

export const auditService = new AuditService();
