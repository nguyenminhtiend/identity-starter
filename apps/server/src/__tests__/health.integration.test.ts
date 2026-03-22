import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../test/app-builder.js';
import { createTestDb, type TestDb } from '../test/db-helper.js';

describe('GET /health', () => {
  let testDb: TestDb;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildTestApp({ db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.teardown();
  });

  it('should return status ok with database connectivity', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks.database).toBe('ok');
  });
});
