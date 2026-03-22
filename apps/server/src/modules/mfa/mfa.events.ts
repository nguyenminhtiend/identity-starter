export const MFA_EVENTS = {
  TOTP_ENROLLED: 'mfa.totp.enrolled',
  TOTP_DISABLED: 'mfa.totp.disabled',
  TOTP_VERIFIED: 'mfa.totp.verified',
  RECOVERY_CODES_GENERATED: 'mfa.recovery_codes.generated',
  RECOVERY_CODE_USED: 'mfa.recovery_code.used',
} as const;

export interface MfaTotpEnrolledPayload {
  userId: string;
}

export interface MfaTotpDisabledPayload {
  userId: string;
}

export interface MfaTotpVerifiedPayload {
  userId: string;
}

export interface MfaRecoveryCodesGeneratedPayload {
  userId: string;
}

export interface MfaRecoveryCodeUsedPayload {
  userId: string;
  remaining: number;
}
