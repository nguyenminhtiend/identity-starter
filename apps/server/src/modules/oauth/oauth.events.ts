export const OAUTH_EVENTS = {
  AUTHORIZATION_CODE_ISSUED: 'oauth.authorization_code_issued',
  TOKEN_EXCHANGED: 'oauth.token_exchanged',
  CONSENT_GRANTED: 'oauth.consent_granted',
  CONSENT_REVOKED: 'oauth.consent_revoked',
} as const;

export interface AuthorizationCodeIssuedPayload {
  userId: string;
  clientId: string;
  clientInternalId: string;
}

export interface TokenExchangedPayload {
  userId: string;
  clientId: string;
  clientInternalId: string;
  grantType: string;
}

export interface ConsentGrantedPayload {
  userId: string;
  clientId: string;
  clientInternalId: string;
  scope: string;
}

export interface ConsentRevokedPayload {
  userId: string;
  clientId: string;
  clientInternalId: string;
}
