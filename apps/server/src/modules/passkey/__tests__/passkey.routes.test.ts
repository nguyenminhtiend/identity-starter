import cookie from '@fastify/cookie';
import { UnauthorizedError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import { makeAuthenticationResponse, makeRegistrationResponse } from './passkey.factory.js';

const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistration = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyAuthentication = vi.fn();

vi.mock('../passkey.service.js', () => ({
  createPasskeyService: vi.fn(() => ({
    generateRegistrationOptions: mockGenerateRegistrationOptions,
    verifyRegistration: mockVerifyRegistration,
    generateAuthenticationOptions: mockGenerateAuthenticationOptions,
    verifyAuthentication: mockVerifyAuthentication,
  })),
}));

import { passkeyRoutes } from '../passkey.routes.js';

describe('passkey routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession({ userId: '550e8400-e29b-41d4-a716-446655440001' });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(cookie);

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
    await app.register(passkeyRoutes, { prefix: '/api/auth/passkeys' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockGenerateRegistrationOptions.mockReset();
    mockVerifyRegistration.mockReset();
    mockGenerateAuthenticationOptions.mockReset();
    mockVerifyAuthentication.mockReset();
  });

  describe('POST /api/auth/passkeys/register/options', () => {
    it('returns 200 with registration options', async () => {
      const options = { challenge: 'test-challenge', rp: { name: 'Test', id: 'localhost' } };
      mockGenerateRegistrationOptions.mockResolvedValue(options);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/options',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.challenge).toBe('test-challenge');
    });

    it('calls service with userId from session', async () => {
      mockGenerateRegistrationOptions.mockResolvedValue({ challenge: 'c' });

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/options',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(mockSession.userId);
    });
  });

  describe('POST /api/auth/passkeys/register/verify', () => {
    it('returns 201 with passkeyId on success', async () => {
      mockVerifyRegistration.mockResolvedValue({
        passkeyId: '550e8400-e29b-41d4-a716-446655440099',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/verify',
        headers: { authorization: 'Bearer valid-token' },
        payload: makeRegistrationResponse(),
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.passkeyId).toBe('550e8400-e29b-41d4-a716-446655440099');
    });

    it('returns 401 when challenge expired', async () => {
      mockVerifyRegistration.mockRejectedValue(
        new UnauthorizedError('Challenge expired or not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/verify',
        headers: { authorization: 'Bearer valid-token' },
        payload: makeRegistrationResponse(),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on missing body fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/verify',
        headers: { authorization: 'Bearer valid-token' },
        payload: { id: 'test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls service with userId and body', async () => {
      const regResponse = makeRegistrationResponse();
      mockVerifyRegistration.mockResolvedValue({ passkeyId: 'pk-1' });

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/register/verify',
        headers: { authorization: 'Bearer valid-token' },
        payload: regResponse,
      });

      expect(mockVerifyRegistration).toHaveBeenCalledWith(
        mockSession.userId,
        expect.objectContaining({ id: regResponse.id }),
      );
    });
  });

  describe('POST /api/auth/passkeys/login/options', () => {
    it('returns 200 with authentication options', async () => {
      const options = { challenge: 'auth-challenge', rpId: 'localhost' };
      mockGenerateAuthenticationOptions.mockResolvedValue(options);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/options',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.challenge).toBe('auth-challenge');
    });

    it('does not require authentication', async () => {
      mockGenerateAuthenticationOptions.mockResolvedValue({ challenge: 'c' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/options',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/auth/passkeys/login/verify', () => {
    it('returns 200 with token and user on success', async () => {
      const authResponse = {
        token: 'session-token',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'test@example.com',
          displayName: 'Test User',
          status: 'active' as const,
        },
      };
      mockVerifyAuthentication.mockResolvedValue(authResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: makeAuthenticationResponse(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBe('session-token');
      expect(body.user.email).toBe('test@example.com');
    });

    it('returns 401 when passkey not found', async () => {
      mockVerifyAuthentication.mockRejectedValue(new UnauthorizedError('Passkey not found'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: makeAuthenticationResponse(),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when verification fails', async () => {
      mockVerifyAuthentication.mockRejectedValue(
        new UnauthorizedError('Passkey authentication failed'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: makeAuthenticationResponse(),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on missing body fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: { id: 'test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('does not require authentication', async () => {
      mockVerifyAuthentication.mockResolvedValue({
        token: 'tok',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'test@example.com',
          displayName: 'Test',
          status: 'active',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: makeAuthenticationResponse(),
      });

      expect(response.statusCode).toBe(200);
    });

    it('calls service with body and meta', async () => {
      const authResp = makeAuthenticationResponse();
      mockVerifyAuthentication.mockResolvedValue({
        token: 'tok',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'test@example.com',
          displayName: 'Test',
          status: 'active',
        },
      });

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkeys/login/verify',
        payload: authResp,
      });

      expect(mockVerifyAuthentication).toHaveBeenCalledWith(
        expect.objectContaining({ id: authResp.id }),
        expect.objectContaining({ ipAddress: expect.any(String) }),
      );
    });
  });
});
