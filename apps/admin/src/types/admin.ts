export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
  createdAt: string;
}

export interface AdminUserDetail extends AdminUser {
  emailVerified: boolean;
  roles: Array<{ id: string; name: string }>;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissionCount: number;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
}

export interface AdminSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  prevHash: string | null;
}

export interface ChainVerification {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstInvalidEntryId: string | null;
}

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  roles: Array<{ id: string; name: string }>;
}
