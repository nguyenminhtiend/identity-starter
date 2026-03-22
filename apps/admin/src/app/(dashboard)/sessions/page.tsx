import { Suspense } from 'react';
import { SessionTable } from '@/components/sessions/session-table';
import { Pagination } from '@/components/shared/pagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PaginatedResponse } from '@/lib/api-client';
import { serverFetch } from '@/lib/api-client';
import type { AdminSession } from '@/types/admin';

interface SessionsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));

  const result = await serverFetch<PaginatedResponse<AdminSession>>(
    `/api/admin/sessions?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionTable sessions={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
