import { createHash } from 'node:crypto';
import type { Database } from '@identity-starter/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuditLog, exportAuditLogs, queryAuditLogs } from '../audit.service.js';
import { makeCreateAuditLogInput } from './audit.factory.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
}));

function resetChain() {
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where, orderBy: mocks.orderBy });
  mocks.where.mockReturnValue({
    orderBy: mocks.orderBy,
    limit: mocks.limit,
    offset: mocks.offset,
  });
  mocks.orderBy.mockReturnValue({ limit: mocks.limit, where: mocks.where, offset: mocks.offset });
  mocks.limit.mockReturnValue({ offset: mocks.offset });
  mocks.offset.mockResolvedValue([]);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([]);
}

function makeDb(): Database {
  return {
    select: mocks.select,
    insert: mocks.insert,
  } as unknown as Database;
}

let db: Database;

beforeEach(() => {
  vi.resetAllMocks();
  resetChain();
  db = makeDb();
});

describe('createAuditLog', () => {
  it('computes prevHash from last entry and inserts row', async () => {
    const lastEntry = {
      id: '00000000-0000-0000-0000-000000000001',
      action: 'auth.login',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const expectedHash = createHash('sha256')
      .update(`${lastEntry.id}${lastEntry.action}${lastEntry.createdAt.toISOString()}`)
      .digest('hex');

    const insertedRow = {
      id: '00000000-0000-0000-0000-000000000002',
      actorId: 'actor-1',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'res-1',
      details: {},
      ipAddress: '127.0.0.1',
      createdAt: new Date(),
      prevHash: expectedHash,
    };

    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([lastEntry]);

    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([insertedRow]);

    const input = makeCreateAuditLogInput();
    const result = await createAuditLog(db, input);

    expect(result).toEqual(insertedRow);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ prevHash: expectedHash }));
  });

  it('sets prevHash to null when no previous entry exists', async () => {
    const insertedRow = {
      id: '00000000-0000-0000-0000-000000000001',
      actorId: 'actor-1',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: null,
      details: {},
      ipAddress: null,
      createdAt: new Date(),
      prevHash: null,
    };

    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([]);

    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([insertedRow]);

    const input = makeCreateAuditLogInput({ resourceId: null, ipAddress: null });
    const result = await createAuditLog(db, input);

    expect(result).toEqual(insertedRow);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ prevHash: null }));
  });

  it('inserts with all fields from input', async () => {
    const insertedRow = {
      id: '00000000-0000-0000-0000-000000000001',
      actorId: 'actor-1',
      action: 'admin.user_suspended',
      resourceType: 'user',
      resourceId: 'user-42',
      details: { reason: 'abuse' },
      ipAddress: '10.0.0.1',
      createdAt: new Date(),
      prevHash: null,
    };

    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue([]);

    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([insertedRow]);

    const input = makeCreateAuditLogInput({
      actorId: 'actor-1',
      action: 'admin.user_suspended',
      resourceType: 'user',
      resourceId: 'user-42',
      details: { reason: 'abuse' },
      ipAddress: '10.0.0.1',
    });

    const result = await createAuditLog(db, input);

    expect(result).toEqual(insertedRow);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'admin.user_suspended',
        resourceType: 'user',
        resourceId: 'user-42',
        details: { reason: 'abuse' },
        ipAddress: '10.0.0.1',
      }),
    );
  });
});

describe('queryAuditLogs', () => {
  it('returns paginated results ordered by created_at desc', async () => {
    const row = {
      id: 'log-1',
      actorId: 'actor-1',
      action: 'auth.login',
      resourceType: 'user',
      resourceId: 'user-1',
      details: {},
      ipAddress: '127.0.0.1',
      createdAt: new Date(),
      prevHash: null,
    };

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 1 }]),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([row]),
              }),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await queryAuditLogs(db, { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.data).toEqual([row]);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('applies actorId filter', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await queryAuditLogs(db, {
      page: 1,
      limit: 20,
      actorId: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('applies action filter', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await queryAuditLogs(db, {
      page: 1,
      limit: 20,
      action: 'auth.login',
    });

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('applies resourceType and resourceId filters', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await queryAuditLogs(db, {
      page: 1,
      limit: 20,
      resourceType: 'session',
      resourceId: '00000000-0000-0000-0000-000000000005',
    });

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('applies date range filters', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await queryAuditLogs(db, {
      page: 1,
      limit: 20,
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    });

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('exportAuditLogs', () => {
  it('returns all matching entries without pagination', async () => {
    const rows = [
      {
        id: 'log-1',
        actorId: 'actor-1',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'user-1',
        details: {},
        ipAddress: '127.0.0.1',
        createdAt: new Date('2025-01-01'),
        prevHash: null,
      },
      {
        id: 'log-2',
        actorId: 'actor-1',
        action: 'auth.logout',
        resourceType: 'user',
        resourceId: 'user-1',
        details: {},
        ipAddress: '127.0.0.1',
        createdAt: new Date('2025-01-02'),
        prevHash: 'abc',
      },
    ];

    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    });

    const result = await exportAuditLogs(db, {});

    expect(result).toEqual(rows);
    expect(result).toHaveLength(2);
  });

  it('applies filters same as query', async () => {
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await exportAuditLogs(db, {
      actorId: '00000000-0000-0000-0000-000000000001',
      action: 'auth.login',
      resourceType: 'user',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    });

    expect(result).toEqual([]);
  });
});
