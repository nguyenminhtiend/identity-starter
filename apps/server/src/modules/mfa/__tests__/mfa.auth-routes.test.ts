import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeMfaVerifyInput } from './mfa.factory.js';

const mockVerifyMfaChallenge = vi.fn();

vi.mock('../mfa.service.js', () => ({
  createMfaService: vi.fn(() => ({
    verifyMfaChallenge: mockVerifyMfaChallenge,
  })),
}));

import { mfaAuthRoutes } from '../mfa.auth-routes.js';

describe('mfa auth routes', () => {
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
    await app.register(mfaAuthRoutes, { prefix: '/api/auth/mfa' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockVerifyMfaChallenge.mockReset();
  });

  it('POST /api/auth/mfa/verify returns 200 with token and user', async () => {
    mockVerifyMfaChallenge.mockResolvedValue({
      token: 'session',
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'a@b.com',
        displayName: 'A',
        status: 'active',
      },
    });

    const payload = makeMfaVerifyInput({ mfaToken: 'mfa', otp: '123456' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBe('session');
    expect(body.user.email).toBe('a@b.com');
    expect(mockVerifyMfaChallenge).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        ipAddress: expect.any(String),
      }),
    );
  });

  it('returns 400 when body invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      payload: { mfaToken: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});
