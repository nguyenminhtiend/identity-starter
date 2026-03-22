'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { clientFetch } from '@/lib/api-client';
import type { AdminUserDetail, Role } from '@/types/admin';

interface UserDetailProps {
  user: AdminUserDetail;
  allRoles: Role[];
}

export function UserDetail({ user, allRoles }: UserDetailProps) {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'suspended') =>
      clientFetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, status) => {
      toast.success(`User ${status === 'suspended' ? 'suspended' : 'activated'}`);
      router.refresh();
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      clientFetch(`/api/admin/users/${user.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ roleId }),
      }),
    onSuccess: () => {
      toast.success('Role assigned');
      setSelectedRoleId('');
      router.refresh();
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (roleId: string) =>
      clientFetch(`/api/admin/users/${user.id}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Role removed');
      router.refresh();
    },
  });

  const assignableRoles = allRoles.filter((r) => !user.roles.some((ur) => ur.id === r.id));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-mono">{user.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Name</p>
              <p>{user.displayName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <Badge variant={user.status === 'active' ? 'default' : 'destructive'}>
                {user.status}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Email verified</p>
              <p>{user.emailVerified ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="font-mono text-xs">{new Date(user.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <Separator />

          <div className="flex gap-2">
            {user.status === 'active' ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('suspended')}
              >
                Suspend
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('active')}
              >
                Activate
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {user.roles.map((role) => (
              <Badge key={role.id} variant="outline" className="gap-1">
                {role.name}
                <button
                  type="button"
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => removeRoleMutation.mutate(role.id)}
                >
                  x
                </button>
              </Badge>
            ))}
            {user.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No roles assigned</p>
            ) : null}
          </div>

          {assignableRoles.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!selectedRoleId || assignRoleMutation.isPending}
                onClick={() => assignRoleMutation.mutate(selectedRoleId)}
              >
                Assign
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
