import { randomBytes } from 'node:crypto';

import { ForbiddenError, NotFoundError, UnauthorizedError } from '@identity-starter/core';
import { authorizationCodes, consentGrants } from '@identity-starter/db';
import { and, eq, isNull } from 'drizzle-orm';

import { createDomainEvent } from '../../infra/event-bus.js';
import type { ClientResponse } from '../client/client.schemas.js';
import { getClientByClientId } from '../client/client.service.js';
import { hashToken } from '../token/refresh-token.service.js';
import { OAUTH_EVENTS } from './oauth.events.js';
import {
  appendQueryParams,
  assertAuthorizeQuery,
  assertClientAllowsAuthCode,
  assertRedirectUri,
  assertRequestedScope,
  consentCovers,
  type OAuthServiceDeps,
  parseScope,
} from './oauth.helpers.js';
import type { AuthorizeQueryInput, ConsentInput, ParRequestBody } from './oauth.schemas.js';
import {
  createParRequest,
  markParRequestUsed,
  type ParRequestParams,
  readParRequest,
} from './par.service.js';

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

async function loadMergedConsentScopes(
  deps: OAuthServiceDeps,
  userId: string,
  clientInternalId: string,
): Promise<Set<string>> {
  const rows = await deps.db
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
      clientInternalId: params.client.id,
    }),
  );

  const redirectUri = appendQueryParams(params.redirectUri, {
    code: plaintext,
    state: params.state,
    iss: deps.env.jwtIssuer,
  });

  return { redirectUri, plaintextCode: plaintext };
}

export async function authorize(
  deps: OAuthServiceDeps,
  userId: string,
  query: AuthorizeQueryInput,
): Promise<AuthorizeResult> {
  assertAuthorizeQuery(query);

  const client = await getClientByClientId(deps.db, query.client_id);

  if (client.status === 'suspended') {
    throw new ForbiddenError('Client is suspended');
  }

  assertClientAllowsAuthCode(client);
  assertRedirectUri(client, query.redirect_uri);
  assertRequestedScope(client, query.scope);

  if (client.isFirstParty) {
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

  const merged = await loadMergedConsentScopes(deps, userId, client.id);
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

export async function createParRequestFlow(
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

export async function authorizeWithPar(
  deps: OAuthServiceDeps,
  userId: string,
  requestUri: string,
  clientId: string,
): Promise<AuthorizeResult> {
  const client = await getClientByClientId(deps.db, clientId);
  const { id: parId, params } = await readParRequest(deps.db, requestUri, client.id);
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
  const result = await authorize(deps, userId, query);
  // Mark the PAR request used only after a terminal success (redirect with an
  // issued code). consent_required is non-terminal — the consent form resubmits
  // via /oauth/consent with the plain params and does not re-read the PAR.
  if (result.type === 'redirect') {
    await markParRequestUsed(deps.db, parId);
  }
  return result;
}

export async function submitConsent(
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
      clientInternalId: client.id,
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

export async function revokeConsent(
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
      clientInternalId: client.id,
    }),
  );
}
