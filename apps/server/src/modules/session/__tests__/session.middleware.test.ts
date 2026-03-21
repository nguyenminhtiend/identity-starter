import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from './session.factory.js';

vi.mock('../session.service.js', () => ({
  validateSession: vi.fn(),
}));

import { authPlugin } from '../../../core/plugins/auth.js';
import { validateSession } from '../session.service.js';

const mockedValidateSession = vi.mocked(validateSession);

describe('authPlugin (requireSession)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });
    await app.register(errorHandlerPlugin);
    await app.register(authPlugin, { validateSession: mockedValidateSession });

    app.get('/test', { preHandler: app.requireSession }, async (request) => {
      return { userId: request.userId, sessionId: request.session.id };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(validateSession).mockReset();
  });

  it('returns 401 when no Authorization header', async () => {
    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header does not start with "Bearer "', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Basic xyz' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is invalid (validateSession returns null)', async () => {
    vi.mocked(validateSession).mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer bad-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHORIZED');
  });

  it('returns 200 and decorates request when token is valid', async () => {
    const session = makeSession({ userId: '550e8400-e29b-41d4-a716-446655440001' });
    vi.mocked(validateSession).mockResolvedValue(session);

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer good-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userId).toBe(session.userId);
    expect(body.sessionId).toBe(session.id);
  });

  it('passes correct token to validateSession', async () => {
    const session = makeSession();
    vi.mocked(validateSession).mockResolvedValue(session);

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer my-secret-token' },
    });

    expect(validateSession).toHaveBeenCalledTimes(1);
    expect(validateSession).toHaveBeenCalledWith(expect.anything(), 'my-secret-token');
  });
});
