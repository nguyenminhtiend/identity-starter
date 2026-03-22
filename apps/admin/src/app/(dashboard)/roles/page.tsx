import { CreateRoleDialog } from '@/components/roles/create-role-dialog';
import { RoleList } from '@/components/roles/role-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { serverFetch } from '@/lib/api-client';
import type { Role } from '@/types/admin';

export default async function RolesPage() {
  const roles = await serverFetch<Role[]>('/api/admin/roles');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles</h1>
        <CreateRoleDialog />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Role management</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleList roles={roles} />
        </CardContent>
      </Card>
    </div>
  );
}
