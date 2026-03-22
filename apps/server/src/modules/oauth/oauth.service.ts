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
import * as jose from 'jose';

import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import type { ClientResponse } from '../client/client.schemas.js';
import { authenticateClient, getClient, getClientByClientId } from '../client/client.service.js';
import { issueAccessToken, issueIdToken, verifyAccessToken } from '../token/jwt.service.js';
import type { RefreshTokenService } from '../token/refresh-token.service.js';
import { hashToken } from '../token/refresh-token.service.js';
import type { SigningKeyService } from '../token/signing-key.service.js';
import { TOKEN_EVENTS } from '../token/token.events.js';
import { OAUTH_EVENTS } from './oauth.events.js';
import type {
  AuthorizeQueryInput,
  ConsentInput,
  EndSessionQuery,
  IntrospectResponse,
  ParRequestBody,
  RevokeInput,
  TokenRequestInput,
  TokenResponse,
  UserinfoResponse,
} from './oauth.schemas.js';
import { consumeParRequest, createParRequest, type ParRequestParams } from './par.service.js';

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
  parTtl: number;
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

async function createParRequestFlow(
  deps: OAuthServiceDeps,
  client: ClientResponse,
  body: ParRequestBody,
): Promise<{ request_uri: string; expires_in: number }> {
  if (body.client_id !== client.clientId) {
    throw new UnauthorizedError('Invalid client');
  }

  if (client.status === 'suspended') {
    throw new ForbiddenError('Client is suspended');
  }

  assertClientAllowsAuthCode(client);
  assertRedirectUri(client, body.redirect_uri);
  assertRequestedScope(client, body.scope);

  const params: ParRequestParams = {
    response_type: 'code',
    redirect_uri: body.redirect_uri,
    scope: body.scope,
    code_challenge: body.code_challenge,
    code_challenge_method: body.code_challenge_method,
    state: body.state,
    nonce: body.nonce,
  };

  return createParRequest(deps.db, client.id, params, deps.env.parTtl);
}

async function authorizeWithPar(
  deps: OAuthServiceDeps,
  userId: string,
  requestUri: string,
  clientId: string,
): Promise<AuthorizeResult> {
  const client = await getClientByClientId(deps.db, clientId);
  const params = await consumeParRequest(deps.db, requestUri, client.id);
  const query: AuthorizeQueryInput = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirect_uri,
    scope: params.scope,
    state: params.state ?? '',
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method as 'S256',
    nonce: params.nonce,
  };
  return authorize(deps, userId, query);
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

async function revokeConsent(
  deps: OAuthServiceDeps,
  userId: string,
  clientId: string,
): Promise<void> {
  const client = await getClientByClientId(deps.db, clientId);

  const [grant] = await deps.db
    .select()
    .from(consentGrants)
    .where(
      and(
        eq(consentGrants.userId, userId),
        eq(consentGrants.clientId, client.id),
        isNull(consentGrants.revokedAt),
      ),
    )
    .limit(1);

  if (!grant) {
    throw new NotFoundError('Consent', clientId);
  }

  const now = new Date();
  await deps.db
    .update(consentGrants)
    .set({ revokedAt: now })
    .where(
      and(
        eq(consentGrants.userId, userId),
        eq(consentGrants.clientId, client.id),
        isNull(consentGrants.revokedAt),
      ),
    );

  await deps.refreshTokenService.revokeAllForClient(client.id, userId);

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.CONSENT_REVOKED, {
      userId,
      clientId: client.clientId,
    }),
  );
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

function extractCnfJkt(payload: jose.JWTPayload): { jkt: string } | undefined {
  const raw = payload.cnf;
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const jkt = (raw as { jkt?: unknown }).jkt;
  if (typeof jkt !== 'string' || jkt === '') {
    return undefined;
  }
  return { jkt };
}

async function introspectFromAccessJwt(
  deps: OAuthServiceDeps,
  token: string,
): Promise<IntrospectResponse | null> {
  const jwks = await deps.signingKeyService.getJwks();
  const localJwks = jose.createLocalJWKSet(jwks);
  const verified = await verifyAccessToken(localJwks, token, deps.env.jwtIssuer);
  if (!verified) {
    return null;
  }

  const { payload } = verified;
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (sub === undefined || sub === '') {
    return null;
  }

  const clientId = typeof payload.client_id === 'string' ? payload.client_id : undefined;
  const scope = typeof payload.scope === 'string' ? payload.scope : undefined;
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
  const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
  const iss = typeof payload.iss === 'string' ? payload.iss : deps.env.jwtIssuer;
  const cnf = extractCnfJkt(payload);

  const out: IntrospectResponse = {
    active: true,
    sub,
    client_id: clientId,
    scope,
    exp,
    iat,
    iss,
    token_type: cnf !== undefined ? 'DPoP+access_token' : 'access_token',
  };

  if (cnf !== undefined) {
    out.cnf = cnf;
  }

  return out;
}

async function introspectFromRefresh(
  deps: OAuthServiceDeps,
  token: string,
): Promise<IntrospectResponse | null> {
  const tokenHash = hashToken(token);

  const [row] = await deps.db
    .select({
      scope: refreshTokens.scope,
      userId: refreshTokens.userId,
      expiresAt: refreshTokens.expiresAt,
      revokedAt: refreshTokens.revokedAt,
      createdAt: refreshTokens.createdAt,
      dpopJkt: refreshTokens.dpopJkt,
      oauthClientId: oauthClients.clientId,
    })
    .from(refreshTokens)
    .innerJoin(oauthClients, eq(refreshTokens.clientId, oauthClients.id))
    .where(eq(refreshTokens.token, tokenHash))
    .limit(1);

  if (!row) {
    return null;
  }

  if (row.revokedAt !== null && row.revokedAt !== undefined) {
    return { active: false };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return { active: false };
  }

  const out: IntrospectResponse = {
    active: true,
    sub: row.userId,
    client_id: row.oauthClientId,
    scope: row.scope,
    exp: Math.floor(row.expiresAt.getTime() / 1000),
    iat: Math.floor(row.createdAt.getTime() / 1000),
    iss: deps.env.jwtIssuer,
    token_type: 'refresh_token',
  };

  if (row.dpopJkt !== null && row.dpopJkt !== undefined && row.dpopJkt !== '') {
    out.cnf = { jkt: row.dpopJkt };
  }

  return out;
}

async function introspectToken(
  deps: OAuthServiceDeps,
  token: string,
  tokenTypeHint?: string,
): Promise<IntrospectResponse> {
  const publish = async (result: IntrospectResponse) => {
    await deps.eventBus.publish(
      createDomainEvent(TOKEN_EVENTS.TOKEN_INTROSPECTED, { active: result.active }),
    );
  };

  if (tokenTypeHint === 'refresh_token') {
    const refreshFirst = await introspectFromRefresh(deps, token);
    if (refreshFirst !== null) {
      await publish(refreshFirst);
      return refreshFirst;
    }
    const jwtSecond = await introspectFromAccessJwt(deps, token);
    if (jwtSecond !== null) {
      await publish(jwtSecond);
      return jwtSecond;
    }
  } else {
    const jwtFirst = await introspectFromAccessJwt(deps, token);
    if (jwtFirst !== null) {
      await publish(jwtFirst);
      return jwtFirst;
    }
    const refreshSecond = await introspectFromRefresh(deps, token);
    if (refreshSecond !== null) {
      await publish(refreshSecond);
      return refreshSecond;
    }
  }

  const inactive: IntrospectResponse = { active: false };
  await publish(inactive);
  return inactive;
}

function audienceClientIdFromPayload(aud: jose.JWTPayload['aud']): string | undefined {
  if (typeof aud === 'string') {
    return aud;
  }
  if (Array.isArray(aud) && aud.length > 0 && typeof aud[0] === 'string') {
    return aud[0];
  }
  return undefined;
}

async function endSession(
  deps: OAuthServiceDeps,
  params: EndSessionQuery,
): Promise<{ redirectUri: string }> {
  let validatedClientId: string | undefined;

  if (params.id_token_hint) {
    try {
      const jwks = await deps.signingKeyService.getJwks();
      const localJwks = jose.createLocalJWKSet(jwks);
      const result = await verifyAccessToken(localJwks, params.id_token_hint, deps.env.jwtIssuer);
      if (result) {
        validatedClientId = audienceClientIdFromPayload(result.payload.aud);
      }
    } catch {
      // Invalid token or JWKS failure — proceed without client validation
    }
  }

  if (params.post_logout_redirect_uri && validatedClientId) {
    try {
      const client = await getClientByClientId(deps.db, validatedClientId);
      if (!client.redirectUris.includes(params.post_logout_redirect_uri)) {
        throw new ValidationError('post_logout_redirect_uri is not registered', {
          post_logout_redirect_uri: 'Invalid',
        });
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      validatedClientId = undefined;
    }
  }

  if (params.post_logout_redirect_uri && validatedClientId) {
    const url = new URL(params.post_logout_redirect_uri);
    if (params.state !== undefined) {
      url.searchParams.set('state', params.state);
    }
    return { redirectUri: url.toString() };
  }

  return { redirectUri: deps.env.jwtIssuer };
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
    authorizeWithPar: (userId: string, requestUri: string, clientId: string) =>
      authorizeWithPar(deps, userId, requestUri, clientId),
    createParRequest: (client: ClientResponse, body: ParRequestBody) =>
      createParRequestFlow(deps, client, body),
    submitConsent: (userId: string, input: ConsentInput) => submitConsent(deps, userId, input),
    revokeConsent: (userId: string, oauthClientId: string) =>
      revokeConsent(deps, userId, oauthClientId),
    exchangeToken: (request: TokenRequestInput, authenticatedClient: ClientResponse | null) =>
      exchangeToken(deps, request, authenticatedClient),
    revokeToken: (input: RevokeInput) => revokeToken(deps, input),
    getUserInfo: (userId: string, scope: string) => getUserInfo(deps, userId, scope),
    introspectToken: (token: string, tokenTypeHint?: string) =>
      introspectToken(deps, token, tokenTypeHint),
    endSession: (params: EndSessionQuery) => endSession(deps, params),
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
