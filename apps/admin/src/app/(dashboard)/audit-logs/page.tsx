import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Suspense } from 'react';
import { AuditLogFilters } from '@/components/audit/audit-log-filters';
import { AuditLogTable } from '@/components/audit/audit-log-table';
import { Pagination } from '@/components/shared/pagination';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PaginatedResponse } from '@/lib/api-client';
import { serverFetch } from '@/lib/api-client';
import type { AuditLogEntry, ChainVerification } from '@/types/admin';

interface AuditLogsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '50');
  const action = params.action ?? '';
  const resourceType = params.resourceType ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (action) {
    query.set('action', action);
  }
  if (resourceType) {
    query.set('resourceType', resourceType);
  }

  const [result, verification] = await Promise.all([
    serverFetch<PaginatedResponse<AuditLogEntry>>(`/api/admin/audit-logs?${query.toString()}`),
    serverFetch<ChainVerification>('/api/admin/audit-logs/verify'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <div className="flex items-center gap-2">
          {verification.valid ? (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Chain valid ({verification.checkedEntries} entries)
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Chain broken
            </Badge>
          )}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Activity log</CardTitle>
          <CardDescription>All administrative actions are recorded here</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <AuditLogFilters />
          </Suspense>
          <AuditLogTable entries={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
