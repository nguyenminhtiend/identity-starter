import { createHash } from 'node:crypto';

import { ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';

import type { EventBus } from '../../infra/event-bus.js';
import type { ClientResponse } from '../client/client.schemas.js';
import type { RefreshTokenService } from '../token/refresh-token.service.js';
import type { SigningKeyService } from '../token/signing-key.service.js';

export interface OAuthServiceEnv {
  jwtIssuer: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  authCodeTtl: number;
  refreshGracePeriod: number;
  parTtl: number;
}

export interface OAuthServiceDeps {
  db: Database;
  eventBus: EventBus;
  signingKeyService: SigningKeyService;
  refreshTokenService: RefreshTokenService;
  env: OAuthServiceEnv;
}

export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === codeChallenge;
}

export function parseScope(scope: string): string[] {
  return scope
    .split(/[\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scopeSet(scope: string): Set<string> {
  return new Set(parseScope(scope));
}

export function scopeSubset(requested: string, allowed: string): boolean {
  const allow = scopeSet(allowed);
  for (const s of parseScope(requested)) {
    if (!allow.has(s)) {
      return false;
    }
  }
  return true;
}

export function consentCovers(granted: Set<string>, requested: string): boolean {
  for (const s of parseScope(requested)) {
    if (!granted.has(s)) {
      return false;
    }
  }
  return true;
}

export function appendQueryParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function assertAuthorizeQuery(query: { code_challenge?: string }): void {
  if (!query.code_challenge?.trim()) {
    throw new ValidationError('code_challenge is required', { code_challenge: 'Required' });
  }
}

export function assertClientAllowsAuthCode(client: ClientResponse): void {
  if (!client.grantTypes.includes('authorization_code')) {
    throw new ValidationError('Client is not allowed to use the authorization code grant', {});
  }
  if (!client.responseTypes.includes('code')) {
    throw new ValidationError('Client is not allowed to use the code response type', {});
  }
}

export function assertRedirectUri(client: ClientResponse, redirectUri: string): void {
  if (!client.redirectUris.includes(redirectUri)) {
    throw new ValidationError('redirect_uri is not registered for this client', {
      redirect_uri: 'Invalid',
    });
  }
}

export function assertRequestedScope(client: ClientResponse, requestedScope: string): void {
  if (!scopeSubset(requestedScope, client.scope)) {
    throw new ValidationError('Requested scope exceeds client registration', { scope: 'Invalid' });
  }
}
