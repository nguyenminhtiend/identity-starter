import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import { makeDisableTotpInput, makeVerifyTotpInput } from './mfa.factory.js';

const mockEnrollTotp = vi.fn();
const mockVerifyTotpEnrollment = vi.fn();
const mockDisableTotp = vi.fn();
const mockRegenerateRecoveryCodes = vi.fn();

vi.mock('../mfa.service.js', () => ({
  createMfaService: vi.fn(() => ({
    enrollTotp: mockEnrollTotp,
    verifyTotpEnrollment: mockVerifyTotpEnrollment,
    disableTotp: mockDisableTotp,
    regenerateRecoveryCodes: mockRegenerateRecoveryCodes,
  })),
}));

import { mfaRoutes } from '../mfa.routes.js';

describe('mfa routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession({ userId: '550e8400-e29b-41d4-a716-446655440001' });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });

    app.decorate('requireSession', async (request: FastifyRequest) => {
      request.session = mockSession;
      request.userId = mockSession.userId;
    });
    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(mfaRoutes, { prefix: '/api/account/mfa' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockEnrollTotp.mockReset();
    mockVerifyTotpEnrollment.mockReset();
    mockDisableTotp.mockReset();
    mockRegenerateRecoveryCodes.mockReset();
  });

  describe('POST /api/account/mfa/totp/enroll', () => {
    it('returns 200 with uri and recovery codes', async () => {
      mockEnrollTotp.mockResolvedValue({
        otpauthUri: 'otpauth://totp/X',
        recoveryCodes: ['AAAA-BBBB'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/account/mfa/totp/enroll',
        headers: { authorization: 'Bearer x' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.otpauthUri).toBe('otpauth://totp/X');
      expect(body.recoveryCodes).toEqual(['AAAA-BBBB']);
      expect(mockEnrollTotp).toHaveBeenCalledWith(mockSession.userId);
    });
  });

  describe('POST /api/account/mfa/totp/verify', () => {
    it('returns 200 message on success', async () => {
      mockVerifyTotpEnrollment.mockResolvedValue(undefined);
      const body = makeVerifyTotpInput({ otp: '654321' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/account/mfa/totp/verify',
        headers: { authorization: 'Bearer x' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBeDefined();
      expect(mockVerifyTotpEnrollment).toHaveBeenCalledWith(mockSession.userId, '654321');
    });

    it('returns 400 on invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/account/mfa/totp/verify',
        headers: { authorization: 'Bearer x' },
        payload: { otp: '12' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/account/mfa/totp', () => {
    it('returns 204', async () => {
      mockDisableTotp.mockResolvedValue(undefined);
      const body = makeDisableTotpInput({ password: 'pw' });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/account/mfa/totp',
        headers: { authorization: 'Bearer x' },
        payload: body,
      });

      expect(response.statusCode).toBe(204);
      expect(mockDisableTotp).toHaveBeenCalledWith(mockSession.userId, 'pw');
    });
  });

  describe('POST /api/account/mfa/recovery-codes/regenerate', () => {
    it('returns 200 with new codes', async () => {
      mockRegenerateRecoveryCodes.mockResolvedValue(['ZZZZ-YYYY']);
      const body = { password: 'step-up' };

      const response = await app.inject({
        method: 'POST',
        url: '/api/account/mfa/recovery-codes/regenerate',
        headers: { authorization: 'Bearer x' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().recoveryCodes).toEqual(['ZZZZ-YYYY']);
      expect(mockRegenerateRecoveryCodes).toHaveBeenCalledWith(mockSession.userId, 'step-up');
    });
  });
});
