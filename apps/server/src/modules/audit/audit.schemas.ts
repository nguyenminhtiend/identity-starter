import { z } from 'zod';

export const auditLogSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  createdAt: z.date(),
  prevHash: z.string().nullable(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  actorId: z.uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export const auditExportQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  actorId: z.uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
});

export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

export const auditChainVerificationResponseSchema = z.object({
  valid: z.boolean(),
  totalEntries: z.number(),
  checkedEntries: z.number(),
  firstInvalidEntryId: z.uuid().nullable(),
});

export interface CreateAuditLogInput {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}
