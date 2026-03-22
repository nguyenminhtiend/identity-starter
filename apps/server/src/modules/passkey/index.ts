export { passkeyRoutes } from './passkey.routes.js';
export * from './passkey.schemas.js';
export {
  createPasskeyService,
  deleteExpiredChallenges,
  generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions,
  type PasskeyService,
  type PasskeyServiceDeps,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from './passkey.service.js';
