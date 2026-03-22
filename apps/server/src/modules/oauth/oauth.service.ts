import { createHash, randomBytes } from 'node:crypto';

import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import {
  authorizationCodes,
  consentGrants,
  oauthClientColumns,
  oauthClients,
  refreshTokens,
  userColumns,
  users,
} from '@identity-starter/db';
import { and, eq, isNull } from 'drizzle-orm';

import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import type { ClientResponse } from '../client/client.schemas.js';
import { authenticateClient, getClient, getClientByClientId } from '../client/client.service.js';
import { issueAccessToken, issueIdToken } from '../token/jwt.service.js';
import type { RefreshTokenService } from '../token/refresh-token.service.js';
import { hashToken } from '../token/refresh-token.service.js';
import type { SigningKeyService } from '../token/signing-key.service.js';
import { OAUTH_EVENTS } from './oauth.events.js';
import type {
  AuthorizeQueryInput,
  ConsentInput,
  RevokeInput,
  TokenRequestInput,
  TokenResponse,
  UserinfoResponse,
} from './oauth.schemas.js';

export type AuthorizeResult =
  | {
      type: 'redirect';
      redirectUri: string;
    }
  | {
      type: 'consent_required';
      client: {
        clientId: string;
        clientName: string;
        scope: string;
        logoUri: string | null;
        policyUri: string | null;
        tosUri: string | null;
      };
      requestedScope: string;
      state: string;
      redirectUri: string;
    };

export interface OAuthServiceEnv {
  jwtIssuer: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  authCodeTtl: number;
  refreshGracePeriod: number;
}

export interface OAuthServiceDeps {
  db: Database;
  eventBus: EventBus;
  signingKeyService: SigningKeyService;
  refreshTokenService: RefreshTokenService;
  env: OAuthServiceEnv;
}

function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === codeChallenge;
}

function parseScope(scope: string): string[] {
  return scope
    .split(/[\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function scopeSet(scope: string): Set<string> {
  return new Set(parseScope(scope));
}

function scopeSubset(requested: string, allowed: string): boolean {
  const allow = scopeSet(allowed);
  for (const s of parseScope(requested)) {
    if (!allow.has(s)) {
      return false;
    }
  }
  return true;
}

function consentCovers(granted: Set<string>, requested: string): boolean {
  for (const s of parseScope(requested)) {
    if (!granted.has(s)) {
      return false;
    }
  }
  return true;
}

function appendQueryParams(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

type OauthClientSafeRow = {
  [K in keyof typeof oauthClientColumns]: (typeof oauthClientColumns)[K]['_']['data'];
};

function mapOAuthClientRow(row: OauthClientSafeRow): ClientResponse {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    description: row.description ?? null,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes as ClientResponse['grantTypes'],
    responseTypes: row.responseTypes as ClientResponse['responseTypes'],
    scope: row.scope,
    tokenEndpointAuthMethod:
      row.tokenEndpointAuthMethod as ClientResponse['tokenEndpointAuthMethod'],
    isConfidential: row.isConfidential,
    logoUri: row.logoUri ?? null,
    tosUri: row.tosUri ?? null,
    policyUri: row.policyUri ?? null,
    applicationType: row.applicationType as ClientResponse['applicationType'],
    status: row.status as ClientResponse['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadMergedConsentScopes(
  db: Database,
  userId: string,
  clientInternalId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ scope: consentGrants.scope })
    .from(consentGrants)
    .where(
      and(
        eq(consentGrants.userId, userId),
        eq(consentGrants.clientId, clientInternalId),
        isNull(consentGrants.revokedAt),
      ),
    );

  const merged = new Set<string>();
  for (const r of rows) {
    for (const s of parseScope(r.scope)) {
      merged.add(s);
    }
  }
  return merged;
}

function assertAuthorizeQuery(query: AuthorizeQueryInput): void {
  if (!query.code_challenge?.trim()) {
    throw new ValidationError('code_challenge is required', { code_challenge: 'Required' });
  }
}

function assertClientAllowsAuthCode(client: ClientResponse): void {
  if (!client.grantTypes.includes('authorization_code')) {
    throw new ValidationError('Client is not allowed to use the authorization code grant', {});
  }
  if (!client.responseTypes.includes('code')) {
    throw new ValidationError('Client is not allowed to use the code response type', {});
  }
}

function assertRedirectUri(client: ClientResponse, redirectUri: string): void {
  if (!client.redirectUris.includes(redirectUri)) {
    throw new ValidationError('redirect_uri is not registered for this client', {
      redirect_uri: 'Invalid',
    });
  }
}

function assertRequestedScope(client: ClientResponse, requestedScope: string): void {
  if (!scopeSubset(requestedScope, client.scope)) {
    throw new ValidationError('Requested scope exceeds client registration', { scope: 'Invalid' });
  }
}

async function issueAuthorizationCode(
  deps: OAuthServiceDeps,
  params: {
    userId: string;
    client: ClientResponse;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    nonce?: string;
    state: string;
  },
): Promise<{ redirectUri: string; plaintextCode: string }> {
  const plaintext = randomBytes(32).toString('base64url');
  const codeHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + deps.env.authCodeTtl * 1000);

  await deps.db.insert(authorizationCodes).values({
    code: codeHash,
    clientId: params.client.id,
    userId: params.userId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    nonce: params.nonce ?? null,
    state: params.state,
    expiresAt,
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.AUTHORIZATION_CODE_ISSUED, {
      userId: params.userId,
      clientId: params.client.clientId,
    }),
  );

  const redirectUri = appendQueryParams(params.redirectUri, {
    code: plaintext,
    state: params.state,
    iss: deps.env.jwtIssuer,
  });

  return { redirectUri, plaintextCode: plaintext };
}

async function authorize(
  deps: OAuthServiceDeps,
  userId: string,
  query: AuthorizeQueryInput,
): Promise<AuthorizeResult> {
  assertAuthorizeQuery(query);

  let client: ClientResponse;
  try {
    client = await getClientByClientId(deps.db, query.client_id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    throw error;
  }

  if (client.status === 'suspended') {
    throw new ForbiddenError('Client is suspended');
  }

  assertClientAllowsAuthCode(client);
  assertRedirectUri(client, query.redirect_uri);
  assertRequestedScope(client, query.scope);

  const merged = await loadMergedConsentScopes(deps.db, userId, client.id);
  if (!consentCovers(merged, query.scope)) {
    return {
      type: 'consent_required',
      client: {
        clientId: client.clientId,
        clientName: client.clientName,
        scope: client.scope,
        logoUri: client.logoUri,
        policyUri: client.policyUri,
        tosUri: client.tosUri,
      },
      requestedScope: query.scope,
      state: query.state,
      redirectUri: query.redirect_uri,
    };
  }

  const { redirectUri } = await issueAuthorizationCode(deps, {
    userId,
    client,
    redirectUri: query.redirect_uri,
    scope: query.scope,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    nonce: query.nonce,
    state: query.state,
  });

  return { type: 'redirect', redirectUri };
}

async function submitConsent(
  deps: OAuthServiceDeps,
  userId: string,
  input: ConsentInput,
): Promise<{ type: 'redirect'; redirectUri: string }> {
  const client = await getClientByClientId(deps.db, input.client_id);

  if (client.status === 'suspended') {
    throw new ForbiddenError('Client is suspended');
  }

  assertClientAllowsAuthCode(client);
  assertRedirectUri(client, input.redirect_uri);
  assertRequestedScope(client, input.scope);

  if (input.decision === 'deny') {
    const redirectUri = appendQueryParams(input.redirect_uri, {
      error: 'access_denied',
      state: input.state,
    });
    return { type: 'redirect', redirectUri };
  }

  await deps.db.insert(consentGrants).values({
    userId,
    clientId: client.id,
    scope: input.scope,
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.CONSENT_GRANTED, {
      userId,
      clientId: client.clientId,
      scope: input.scope,
    }),
  );

  const { redirectUri } = await issueAuthorizationCode(deps, {
    userId,
    client,
    redirectUri: input.redirect_uri,
    scope: input.scope,
    codeChallenge: input.code_challenge,
    codeChallengeMethod: input.code_challenge_method,
    nonce: input.nonce,
    state: input.state,
  });

  return { type: 'redirect', redirectUri };
}

async function validateConfidentialClient(
  db: Database,
  client: ClientResponse,
  request: TokenRequestInput,
  authenticatedClient: ClientResponse | null,
): Promise<void> {
  if (!client.isConfidential) {
    return;
  }

  if (authenticatedClient && authenticatedClient.id === client.id) {
    return;
  }

  if (request.client_secret) {
    const authed = await authenticateClient(db, client.clientId, request.client_secret);
    if (authed && authed.id === client.id) {
      return;
    }
  }

  throw new UnauthorizedError('Invalid client');
}

function assertPublicClientIdMatches(
  client: ClientResponse,
  requestClientId: string | undefined,
): void {
  if (
    !client.isConfidential &&
    requestClientId !== undefined &&
    requestClientId !== client.clientId
  ) {
    throw new UnauthorizedError('Invalid client');
  }
}

async function issueTokenBundle(
  deps: OAuthServiceDeps,
  params: {
    userId: string;
    client: ClientResponse;
    scope: string;
    nonce?: string;
    refreshPlaintext?: string;
  },
): Promise<TokenResponse> {
  const signingKey = await deps.signingKeyService.getActiveSigningKey();

  const accessToken = await issueAccessToken(signingKey, {
    issuer: deps.env.jwtIssuer,
    subject: params.userId,
    audience: params.client.clientId,
    scope: params.scope,
    clientId: params.client.clientId,
    expiresInSeconds: deps.env.accessTokenTtl,
  });

  let idToken: string | undefined;
  if (scopeSet(params.scope).has('openid')) {
    idToken = await issueIdToken(signingKey, {
      issuer: deps.env.jwtIssuer,
      subject: params.userId,
      audience: params.client.clientId,
      nonce: params.nonce,
      authTime: Math.floor(Date.now() / 1000),
      acr: '0',
      amr: ['pwd'],
      accessToken,
      expiresInSeconds: deps.env.accessTokenTtl,
    });
  }

  let refreshToken = params.refreshPlaintext;
  if (refreshToken === undefined) {
    const created = await deps.refreshTokenService.createRefreshToken({
      clientId: params.client.id,
      userId: params.userId,
      scope: params.scope,
      expiresInSeconds: deps.env.refreshTokenTtl,
    });
    refreshToken = created.plaintext;
  }

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: deps.env.accessTokenTtl,
    refresh_token: refreshToken,
    id_token: idToken,
    scope: params.scope,
  };
}

async function exchangeAuthorizationCode(
  deps: OAuthServiceDeps,
  request: Extract<TokenRequestInput, { grant_type: 'authorization_code' }>,
  authenticatedClient: ClientResponse | null,
): Promise<TokenResponse> {
  const codeHash = hashToken(request.code);

  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(authorizationCodes)
      .where(eq(authorizationCodes.code, codeHash))
      .limit(1);

    if (!row) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    if (row.usedAt) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    if (row.redirectUri !== request.redirect_uri) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    const [cRow] = await tx
      .select(oauthClientColumns)
      .from(oauthClients)
      .where(eq(oauthClients.id, row.clientId))
      .limit(1);

    if (!cRow) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    const client = mapOAuthClientRow(cRow as OauthClientSafeRow);

    if (request.client_id !== undefined && request.client_id !== client.clientId) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    await validateConfidentialClient(deps.db, client, request, authenticatedClient);
    assertPublicClientIdMatches(client, request.client_id);

    if (!verifyCodeChallenge(request.code_verifier, row.codeChallenge)) {
      throw new UnauthorizedError('Invalid authorization code');
    }

    await tx
      .update(authorizationCodes)
      .set({ usedAt: new Date() })
      .where(eq(authorizationCodes.id, row.id));

    return { row, client };
  });

  const tokenResponse = await issueTokenBundle(deps, {
    userId: result.row.userId,
    client: result.client,
    scope: result.row.scope,
    nonce: result.row.nonce ?? undefined,
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: result.row.userId,
      clientId: result.client.clientId,
      grantType: 'authorization_code',
    }),
  );

  return tokenResponse;
}

async function exchangeClientCredentials(
  deps: OAuthServiceDeps,
  request: Extract<TokenRequestInput, { grant_type: 'client_credentials' }>,
  authenticatedClient: ClientResponse | null,
): Promise<TokenResponse> {
  if (!authenticatedClient) {
    throw new UnauthorizedError('Client authentication required');
  }

  if (!authenticatedClient.isConfidential) {
    throw new ValidationError('Client credentials grant requires a confidential client', {});
  }

  if (authenticatedClient.status === 'suspended') {
    throw new ForbiddenError('Client is suspended');
  }

  if (!authenticatedClient.grantTypes.includes('client_credentials')) {
    throw new ValidationError('Client is not allowed to use the client_credentials grant', {});
  }

  let effectiveScope: string;
  const requested = request.scope?.trim();
  if (requested === undefined || requested === '') {
    effectiveScope = authenticatedClient.scope;
  } else {
    if (!scopeSubset(requested, authenticatedClient.scope)) {
      throw new ValidationError('Requested scope exceeds client registration', {
        scope: 'Invalid',
      });
    }
    effectiveScope = requested;
  }

  const signingKey = await deps.signingKeyService.getActiveSigningKey();
  const accessToken = await issueAccessToken(signingKey, {
    issuer: deps.env.jwtIssuer,
    subject: authenticatedClient.clientId,
    audience: authenticatedClient.clientId,
    scope: effectiveScope,
    clientId: authenticatedClient.clientId,
    expiresInSeconds: deps.env.accessTokenTtl,
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: authenticatedClient.clientId,
      clientId: authenticatedClient.clientId,
      grantType: 'client_credentials',
    }),
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: deps.env.accessTokenTtl,
    scope: effectiveScope,
  };
}

async function exchangeRefreshToken(
  deps: OAuthServiceDeps,
  request: Extract<TokenRequestInput, { grant_type: 'refresh_token' }>,
  authenticatedClient: ClientResponse | null,
): Promise<TokenResponse> {
  const incomingHash = hashToken(request.refresh_token);

  const [rtRow] = await deps.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token, incomingHash))
    .limit(1);

  if (!rtRow) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const client = await getClient(deps.db, rtRow.clientId);

  if (request.client_id !== undefined && request.client_id !== client.clientId) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  await validateConfidentialClient(deps.db, client, request, authenticatedClient);
  assertPublicClientIdMatches(client, request.client_id);

  let effectiveScope = rtRow.scope;
  if (request.scope !== undefined && request.scope.trim() !== '') {
    if (!scopeSubset(request.scope, rtRow.scope)) {
      throw new ValidationError('Requested scope is not allowed for this refresh token', {
        scope: 'Invalid',
      });
    }
    effectiveScope = request.scope.trim();
  }

  const newRefreshPlain = await deps.refreshTokenService.rotateRefreshToken(
    request.refresh_token,
    deps.env.refreshGracePeriod,
  );

  const newHash = hashToken(newRefreshPlain);
  const [newRow] = await deps.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.token, newHash))
    .limit(1);

  if (!newRow) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const tokenResponse = await issueTokenBundle(deps, {
    userId: newRow.userId,
    client,
    scope: effectiveScope,
    refreshPlaintext: newRefreshPlain,
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: newRow.userId,
      clientId: client.clientId,
      grantType: 'refresh_token',
    }),
  );

  return tokenResponse;
}

async function exchangeToken(
  deps: OAuthServiceDeps,
  request: TokenRequestInput,
  authenticatedClient: ClientResponse | null,
): Promise<TokenResponse> {
  if (request.grant_type === 'authorization_code') {
    return exchangeAuthorizationCode(deps, request, authenticatedClient);
  }
  if (request.grant_type === 'client_credentials') {
    return exchangeClientCredentials(deps, request, authenticatedClient);
  }
  return exchangeRefreshToken(deps, request, authenticatedClient);
}

async function revokeToken(deps: OAuthServiceDeps, input: RevokeInput): Promise<void> {
  const tokenHash = hashToken(input.token);
  const now = new Date();

  if (input.token_type_hint === 'access_token') {
    return;
  }

  await deps.db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.token, tokenHash), isNull(refreshTokens.revokedAt)));
}

async function getUserInfo(
  deps: OAuthServiceDeps,
  userId: string,
  scope: string,
): Promise<UserinfoResponse> {
  const [row] = await deps.db.select(userColumns).from(users).where(eq(users.id, userId)).limit(1);

  if (!row) {
    throw new NotFoundError('User', userId);
  }

  const scopes = scopeSet(scope);
  const out: UserinfoResponse = { sub: row.id };

  if (scopes.has('profile')) {
    out.name = row.displayName;
  }

  if (scopes.has('email')) {
    out.email = row.email;
    out.email_verified = row.emailVerified;
  }

  return out;
}

export function createOAuthService(deps: OAuthServiceDeps) {
  return {
    authorize: (userId: string, query: AuthorizeQueryInput) => authorize(deps, userId, query),
    submitConsent: (userId: string, input: ConsentInput) => submitConsent(deps, userId, input),
    exchangeToken: (request: TokenRequestInput, authenticatedClient: ClientResponse | null) =>
      exchangeToken(deps, request, authenticatedClient),
    revokeToken: (input: RevokeInput) => revokeToken(deps, input),
    getUserInfo: (userId: string, scope: string) => getUserInfo(deps, userId, scope),
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
