import { auditLogs } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { registerAuditListener } from '../audit.listener.js';
import { createAuditLog, queryAuditLogs } from '../audit.service.js';
import { makeCreateAuditLogInput } from './audit.factory.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
  eventBus = new InMemoryEventBus();
  registerAuditListener(testDb.db, eventBus);
});

afterAll(async () => {
  await testDb.teardown();
});

describe('audit log anonymization on user deletion', () => {
  it('nullifies actorId in audit logs when user.deleted is emitted', async () => {
    const actorId = '550e8400-e29b-41d4-a716-446655440099';

    await createAuditLog(testDb.db, makeCreateAuditLogInput({ actorId, action: 'test.action1' }));
    await createAuditLog(testDb.db, makeCreateAuditLogInput({ actorId, action: 'test.action2' }));
    const otherActorId = '550e8400-e29b-41d4-a716-446655440077';
    await createAuditLog(
      testDb.db,
      makeCreateAuditLogInput({ actorId: otherActorId, action: 'test.action3' }),
    );

    await eventBus.publish(createDomainEvent('user.deleted', { userId: actorId }));

    const rows = await testDb.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'test.action1'));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBeNull();

    const rows2 = await testDb.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'test.action2'));
    expect(rows2[0].actorId).toBeNull();

    const rows3 = await testDb.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'test.action3'));
    expect(rows3[0].actorId).toBe(otherActorId);
  });

  it('preserves audit log entries (rows not deleted)', async () => {
    const actorId = '550e8400-e29b-41d4-a716-446655440088';

    await createAuditLog(testDb.db, makeCreateAuditLogInput({ actorId, action: 'test.preserved' }));

    const before = await queryAuditLogs(testDb.db, {
      page: 1,
      limit: 1000,
      action: 'test.preserved',
    });
    const countBefore = before.total;

    await eventBus.publish(createDomainEvent('user.deleted', { userId: actorId }));

    const after = await queryAuditLogs(testDb.db, {
      page: 1,
      limit: 1000,
      action: 'test.preserved',
    });
    expect(after.total).toBe(countBefore);
  });
});
