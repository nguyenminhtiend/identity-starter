import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { UserDetail } from '@/components/users/user-detail';
import { serverFetch } from '@/lib/api-client.server';
import type { AdminUserDetail, Role } from '@/types/admin';

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = await params;

  const [user, roles] = await Promise.all([
    serverFetch<AdminUserDetail>(`/api/admin/users/${id}`),
    serverFetch<Role[]>('/api/admin/roles'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/users" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold">{user.displayName}</h1>
      </div>
      <UserDetail user={user} allRoles={roles} />
    </div>
  );
}
