export const AUTH_EVENTS = {
  REGISTERED: 'auth.registered',
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  FAILED_LOGIN: 'auth.failed_login',
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
