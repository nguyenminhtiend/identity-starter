export { createDb, type Database } from './client.js';
export {
  challengeTypeEnum,
  emailVerificationTokenColumns,
  emailVerificationTokens,
  loginAttempts,
  mfaChallenges,
  passkeyColumns,
  passkeys,
  passwordResetTokens,
  recoveryCodes,
  sessionColumns,
  sessions,
  totpSecretColumns,
  totpSecrets,
  userColumns,
  users,
  webauthnChallenges,
} from './schema/index.js';
