export const RBAC_EVENTS = {
  ROLE_CREATED: 'admin.role_created',
  ROLE_UPDATED: 'admin.role_updated',
  ROLE_ASSIGNED: 'admin.role_assigned',
  ROLE_REMOVED: 'admin.role_removed',
} as const;

export interface RoleCreatedPayload {
  roleId: string;
  name: string;
}

export interface RoleUpdatedPayload {
  roleId: string;
}

export interface RoleAssignedPayload {
  userId: string;
  roleId: string;
  assignedBy: string;
}

export interface RoleRemovedPayload {
  userId: string;
  roleId: string;
  removedBy: string;
}
