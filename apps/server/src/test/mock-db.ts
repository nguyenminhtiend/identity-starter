import type { Database } from '@identity-starter/db';
import { type Mock, vi } from 'vitest';

/**
 * Builds a `Database`-typed mock from a partial spec. Tests supply only the
 * methods (`select`, `insert`, etc.) they exercise; the cast happens here so
 * call sites stay readable and don't each repeat `as unknown as Database`.
 */
export type MockDbMethods = Partial<{
  select: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  transaction: Mock;
  execute: Mock;
}>;

export function createMockDb(overrides: MockDbMethods = {}): Database {
  return overrides as unknown as Database;
}

/** Common Drizzle chain shape: `select().from().where().limit()` → rows. */
export function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

/** `select().from().where()` without `.limit()` (returns rows directly). */
export function selectFromWhereRows(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}
