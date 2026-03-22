export { accountRoutes } from './account.routes.js';
export * from './account.schemas.js';
export {
  type AccountService,
  type AccountServiceDeps,
  createAccountService,
  deletePasskey,
  getProfile,
  listPasskeys,
  listSessions,
  renamePasskey,
  revokeOwnSession,
  updateProfile,
} from './account.service.js';
