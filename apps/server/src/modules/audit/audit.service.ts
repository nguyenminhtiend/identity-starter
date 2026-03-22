import { createHash } from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { auditLogs } from '@identity-starter/db';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { AuditExportQuery, AuditLogQuery, CreateAuditLogInput } from './audit.schemas.js';

function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256').update(`${id}${action}${createdAt.toISOString()}`).digest('hex');
}

function buildWhereConditions(filters: {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
}): SQL[] {
  const conditions: SQL[] = [];
  if (filters.actorId) {
    conditions.push(eq(auditLogs.actorId, filters.actorId));
  }
  if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters.resourceType) {
    conditions.push(eq(auditLogs.resourceType, filters.resourceType));
  }
  if (filters.resourceId) {
    conditions.push(eq(auditLogs.resourceId, filters.resourceId));
  }
  if (filters.startDate) {
    conditions.push(gte(auditLogs.createdAt, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(auditLogs.createdAt, filters.endDate));
  }
  return conditions;
}

export async function createAuditLog(db: Database, input: CreateAuditLogInput) {
  const [lastEntry] = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  const prevHash = lastEntry
    ? computeHash(lastEntry.id, lastEntry.action, lastEntry.createdAt)
    : null;

  const [row] = await db
    .insert(auditLogs)
    .values({
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      details: input.details ?? {},
      ipAddress: input.ipAddress ?? null,
      prevHash,
    })
    .returning();

  return row;
}

export async function queryAuditLogs(db: Database, query: AuditLogQuery) {
  const conditions = buildWhereConditions(query);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);

  const offset = (query.page - 1) * query.limit;
  const data = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit)
    .offset(offset);

  return { data, total, page: query.page, limit: query.limit };
}

export async function exportAuditLogs(db: Database, query: AuditExportQuery) {
  const conditions = buildWhereConditions(query);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select().from(auditLogs).where(where).orderBy(asc(auditLogs.createdAt));
}

export async function verifyAuditChain(db: Database): Promise<{
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
}> {
  const entries = await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt));

  if (entries.length === 0) {
    return { valid: true, totalEntries: 0, checkedEntries: 0, firstInvalidEntryId: null };
  }

  if (entries[0].prevHash !== null) {
    return {
      valid: false,
      totalEntries: entries.length,
      checkedEntries: 1,
      firstInvalidEntryId: entries[0].id,
    };
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const expectedHash = computeHash(prev.id, prev.action, prev.createdAt);
    if (entries[i].prevHash !== expectedHash) {
      return {
        valid: false,
        totalEntries: entries.length,
        checkedEntries: i + 1,
        firstInvalidEntryId: entries[i].id,
      };
    }
  }

  return {
    valid: true,
    totalEntries: entries.length,
    checkedEntries: entries.length,
    firstInvalidEntryId: null,
  };
}

export async function anonymizeActorInAuditLogs(db: Database, actorId: string): Promise<void> {
  await db.update(auditLogs).set({ actorId: null }).where(eq(auditLogs.actorId, actorId));
}
