import { Suspense } from 'react';
import { Pagination } from '@/components/shared/pagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserFilters } from '@/components/users/user-filters';
import { UserTable } from '@/components/users/user-table';
import type { PaginatedResponse } from '@/lib/api-client';
import { serverFetch } from '@/lib/api-client';
import type { AdminUser } from '@/types/admin';

interface UsersPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const limit = Number(params.limit ?? '20');
  const status = params.status ?? '';
  const email = params.email ?? '';

  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(limit));
  if (status) {
    query.set('status', status);
  }
  if (email) {
    query.set('email', email);
  }

  const result = await serverFetch<PaginatedResponse<AdminUser>>(
    `/api/admin/users?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>User management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={null}>
            <UserFilters />
          </Suspense>
          <UserTable users={result.data} />
          <Suspense fallback={null}>
            <Pagination page={result.page} limit={result.limit} total={result.total} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
