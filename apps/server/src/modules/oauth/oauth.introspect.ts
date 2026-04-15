import { NotFoundError, ValidationError } from '@identity-starter/core';
import { oauthClients, refreshTokens, userColumns, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import * as jose from 'jose';

import { createDomainEvent } from '../../infra/event-bus.js';
import { getClientByClientId } from '../client/client.service.js';
import { verifyAccessToken } from '../token/jwt.service.js';
import { hashToken } from '../token/refresh-token.service.js';
import { TOKEN_EVENTS } from '../token/token.events.js';
import { type OAuthServiceDeps, scopeSet } from './oauth.helpers.js';
import type { EndSessionQuery, IntrospectResponse, UserinfoResponse } from './oauth.schemas.js';

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

export async function introspectToken(
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

export async function endSession(
  deps: OAuthServiceDeps,
  params: EndSessionQuery,
): Promise<{ redirectUri: string }> {
  let validatedClientId: string | undefined;

  if (params.id_token_hint) {
    try {
      const jwks = await deps.signingKeyService.getJwks();
      const localJwks = jose.createLocalJWKSet(jwks);
      const { payload } = await jose.jwtVerify(params.id_token_hint, localJwks, {
        issuer: deps.env.jwtIssuer,
        algorithms: ['RS256'],
        clockTolerance: 315_360_000,
      });
      validatedClientId = audienceClientIdFromPayload(payload.aud);
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

export async function getUserInfo(
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
