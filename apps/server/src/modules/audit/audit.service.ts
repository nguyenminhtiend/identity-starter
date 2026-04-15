import { createHash } from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { auditLogs } from '@identity-starter/db';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, gt, gte, lte } from 'drizzle-orm';
import type { AuditExportQuery, AuditLogQuery, CreateAuditLogInput } from './audit.schemas.js';

function computeHash(id: string, action: string, createdAt: Date): string {
  return createHash('sha256').update(`${id}${action}${createdAt.toISOString()}`).digest('hex');
}

const MAX_EXPORT_ROWS = 100_000;

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

const PII_KEY_SUBSTRINGS = [
  'email',
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'ssn',
  'creditcard',
  'cardnumber',
] as const;

function keyMatchesPii(key: string): boolean {
  const compact = key.toLowerCase().replace(/[_\s-]/g, '');
  return PII_KEY_SUBSTRINGS.some((fragment) => compact.includes(fragment));
}

function redactNestedValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactNestedValue(item));
  }
  if (typeof value === 'object') {
    return redactPii(value as Record<string, unknown>);
  }
  return value;
}

function redactPii(details: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (keyMatchesPii(key)) {
      result[key] = '[REDACTED]';
      continue;
    }
    result[key] = redactNestedValue(value);
  }
  return result;
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
      details: redactPii(input.details ?? {}),
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

  return db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(asc(auditLogs.createdAt))
    .limit(MAX_EXPORT_ROWS);
}

const DEFAULT_MAX_VERIFY_ENTRIES = 10_000;

export interface VerifyAuditChainOptions {
  /** Max entries to check before stopping. Defaults to 10 000. */
  maxEntries?: number;
  /** Resume from a known-good checkpoint: the entry ID to start after. */
  afterId?: string;
  /** The prevHash value that the entry *after* afterId should carry. */
  expectedPrevHash?: string | null;
}

export async function verifyAuditChain(
  db: Database,
  options: VerifyAuditChainOptions = {},
): Promise<{
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
  lastCheckedId: string | null;
  lastHash: string | null;
}> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_VERIFY_ENTRIES;
  const BATCH_SIZE = 1000;
  let offset = 0;
  let previousHash: string | null = options.expectedPrevHash ?? null;
  let checkedEntries = 0;
  let isFirstEntry = !options.afterId;
  let lastCheckedId: string | null = null;

  const startCondition = options.afterId
    ? gt(
        auditLogs.createdAt,
        db
          .select({ createdAt: auditLogs.createdAt })
          .from(auditLogs)
          .where(eq(auditLogs.id, options.afterId)),
      )
    : undefined;

  while (checkedEntries < maxEntries) {
    const remaining = maxEntries - checkedEntries;
    const batchLimit = Math.min(BATCH_SIZE, remaining);

    const baseQuery = db
      .select()
      .from(auditLogs)
      .orderBy(asc(auditLogs.createdAt))
      .limit(batchLimit)
      .offset(offset);

    const batch = startCondition ? await baseQuery.where(startCondition) : await baseQuery;

    if (batch.length === 0) {
      break;
    }

    for (const entry of batch) {
      checkedEntries++;

      if (isFirstEntry) {
        if (entry.prevHash !== null) {
          return {
            valid: false,
            totalEntries: checkedEntries,
            checkedEntries: 1,
            firstInvalidEntryId: entry.id,
            lastCheckedId: entry.id,
            lastHash: null,
          };
        }
        isFirstEntry = false;
      } else {
        if (entry.prevHash !== previousHash) {
          return {
            valid: false,
            totalEntries: checkedEntries,
            checkedEntries,
            firstInvalidEntryId: entry.id,
            lastCheckedId: entry.id,
            lastHash: previousHash,
          };
        }
      }

      previousHash = computeHash(entry.id, entry.action, entry.createdAt);
      lastCheckedId = entry.id;
    }

    if (batch.length < batchLimit) {
      break;
    }
    offset += batchLimit;
  }

  return {
    valid: true,
    totalEntries: checkedEntries,
    checkedEntries,
    firstInvalidEntryId: null,
    lastCheckedId,
    lastHash: previousHash,
  };
}

export async function anonymizeActorInAuditLogs(db: Database, actorId: string): Promise<void> {
  await db.update(auditLogs).set({ actorId: null }).where(eq(auditLogs.actorId, actorId));
}
