import type { ClientResponse } from '../client/client.schemas.js';
import {
  authorize,
  authorizeWithPar,
  createParRequestFlow,
  revokeConsent,
  submitConsent,
} from './oauth.authorize.js';
import type { OAuthServiceDeps } from './oauth.helpers.js';
import { endSession, getUserInfo, introspectToken } from './oauth.introspect.js';
import type {
  AuthorizeQueryInput,
  ConsentInput,
  EndSessionQuery,
  ParRequestBody,
  RevokeInput,
  TokenRequestInput,
} from './oauth.schemas.js';
import { exchangeToken, revokeToken } from './oauth.token.js';

export type { AuthorizeResult } from './oauth.authorize.js';
export type { OAuthServiceDeps, OAuthServiceEnv } from './oauth.helpers.js';

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
    exchangeToken: (
      request: TokenRequestInput,
      authenticatedClient: ClientResponse | null,
      dpopJkt?: string,
    ) => exchangeToken(deps, request, authenticatedClient, dpopJkt),
    revokeToken: (input: RevokeInput) => revokeToken(deps, input),
    getUserInfo: (userId: string, scope: string) => getUserInfo(deps, userId, scope),
    introspectToken: (token: string, tokenTypeHint?: string) =>
      introspectToken(deps, token, tokenTypeHint),
    endSession: (params: EndSessionQuery) => endSession(deps, params),
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
