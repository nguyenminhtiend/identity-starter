import type { Database } from '@identity-starter/db';
import { loginAttempts } from '@identity-starter/db';
import { and, count, eq, gt, lte } from 'drizzle-orm';

export async function recordAttempt(
  db: Database,
  input: { email: string; ipAddress: string; success: boolean },
): Promise<void> {
  await db.insert(loginAttempts).values({
    email: input.email,
    ipAddress: input.ipAddress,
    success: input.success,
  });
}

export async function getRecentFailureCount(db: Database, email: string): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [result] = await db
    .select({ count: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, cutoff),
      ),
    );
  return result?.count ?? 0;
}

export function calculateDelay(failureCount: number): number {
  if (failureCount < 5) {
    return 0;
  }
  return Math.min(2 ** (failureCount - 5), 30);
}

export async function pruneOldAttempts(db: Database): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(loginAttempts)
    .where(lte(loginAttempts.createdAt, cutoff))
    .returning({ id: loginAttempts.id });
  return deleted.length;
}

export interface LoginAttemptsServiceDeps {
  db: Database;
}

export function createLoginAttemptsService(deps: LoginAttemptsServiceDeps) {
  const { db } = deps;
  return {
    record: (input: { email: string; ipAddress: string; success: boolean }) =>
      recordAttempt(db, input),
    getRecentFailureCount: (email: string) => getRecentFailureCount(db, email),
    calculateDelay,
    pruneOld: () => pruneOldAttempts(db),
  };
}

export type LoginAttemptsService = ReturnType<typeof createLoginAttemptsService>;
