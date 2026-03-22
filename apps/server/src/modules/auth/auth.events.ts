export const AUTH_EVENTS = {
  REGISTERED: 'auth.registered',
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  FAILED_LOGIN: 'auth.failed_login',
  EMAIL_VERIFIED: 'auth.email_verified',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset.completed',
} as const;

export interface AuthRegisteredPayload {
  userId: string;
}

export interface AuthLoginPayload {
  userId: string;
}

export interface AuthLogoutPayload {
  userId: string;
  sessionId: string;
}

export interface AuthPasswordChangedPayload {
  userId: string;
}

export interface AuthFailedLoginPayload {
  email: string;
  reason: string;
}

export interface AuthPasswordResetRequestedPayload {
  userId: string;
  email: string;
  token: string;
}

export interface AuthPasswordResetCompletedPayload {
  userId: string;
}

export interface AuthEmailVerifiedPayload {
  userId: string;
}
