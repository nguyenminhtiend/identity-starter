export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
}

export interface AuthResponse {
  token: string;
  verificationToken?: string;
  user: ApiUser;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse;

export interface MfaVerifyResponse {
  token: string;
  user: ApiUser;
}

export function isMfaChallenge(response: LoginResponse): response is MfaChallengeResponse {
  return 'mfaRequired' in response && response.mfaRequired === true;
}
