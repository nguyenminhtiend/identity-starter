import { ForbiddenError, UnauthorizedError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import {
  authorizationCodes,
  oauthClientColumns,
  oauthClients,
  refreshTokens,
} from '@identity-starter/db';
import { and, eq, isNull } from 'drizzle-orm';

import { createDomainEvent } from '../../infra/event-bus.js';
import type { ClientResponse } from '../client/client.schemas.js';
import { authenticateClient, getClient, mapToClientResponse } from '../client/client.service.js';
import { issueAccessToken, issueIdToken } from '../token/jwt.service.js';
import { hashToken } from '../token/refresh-token.service.js';
import { OAUTH_EVENTS } from './oauth.events.js';
import {
  type OAuthServiceDeps,
  scopeSet,
  scopeSubset,
  verifyCodeChallenge,
} from './oauth.helpers.js';
import type { RevokeInput, TokenRequestInput, TokenResponse } from './oauth.schemas.js';

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
    dpopJkt?: string;
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
    ...(params.dpopJkt !== undefined ? { dpopJkt: params.dpopJkt } : {}),
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
      ...(params.dpopJkt !== undefined ? { dpopJkt: params.dpopJkt } : {}),
    });
    refreshToken = created.plaintext;
  }

  return {
    access_token: accessToken,
    token_type: params.dpopJkt !== undefined ? 'DPoP' : 'Bearer',
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
  dpopJkt?: string,
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

    const client = mapToClientResponse(cRow as Parameters<typeof mapToClientResponse>[0]);

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
    ...(dpopJkt !== undefined ? { dpopJkt } : {}),
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: result.row.userId,
      clientId: result.client.clientId,
      clientInternalId: result.client.id,
      grantType: 'authorization_code',
    }),
  );

  return tokenResponse;
}

async function exchangeClientCredentials(
  deps: OAuthServiceDeps,
  request: Extract<TokenRequestInput, { grant_type: 'client_credentials' }>,
  authenticatedClient: ClientResponse | null,
  dpopJkt?: string,
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
    ...(dpopJkt !== undefined ? { dpopJkt } : {}),
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: authenticatedClient.clientId,
      clientId: authenticatedClient.clientId,
      clientInternalId: authenticatedClient.id,
      grantType: 'client_credentials',
    }),
  );

  return {
    access_token: accessToken,
    token_type: dpopJkt !== undefined ? 'DPoP' : 'Bearer',
    expires_in: deps.env.accessTokenTtl,
    scope: effectiveScope,
  };
}

async function exchangeRefreshToken(
  deps: OAuthServiceDeps,
  request: Extract<TokenRequestInput, { grant_type: 'refresh_token' }>,
  authenticatedClient: ClientResponse | null,
  dpopJkt?: string,
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
    dpopJkt,
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
    ...(dpopJkt !== undefined ? { dpopJkt } : {}),
  });

  await deps.eventBus.publish(
    createDomainEvent(OAUTH_EVENTS.TOKEN_EXCHANGED, {
      userId: newRow.userId,
      clientId: client.clientId,
      clientInternalId: client.id,
      grantType: 'refresh_token',
    }),
  );

  return tokenResponse;
}

export async function exchangeToken(
  deps: OAuthServiceDeps,
  request: TokenRequestInput,
  authenticatedClient: ClientResponse | null,
  dpopJkt?: string,
): Promise<TokenResponse> {
  if (request.grant_type === 'authorization_code') {
    return exchangeAuthorizationCode(deps, request, authenticatedClient, dpopJkt);
  }
  if (request.grant_type === 'client_credentials') {
    return exchangeClientCredentials(deps, request, authenticatedClient, dpopJkt);
  }
  return exchangeRefreshToken(deps, request, authenticatedClient, dpopJkt);
}

export async function revokeToken(deps: OAuthServiceDeps, input: RevokeInput): Promise<void> {
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
