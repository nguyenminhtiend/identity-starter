import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminUser } from '@/types/admin';

interface UserTableProps {
  users: AdminUser[];
}

const statusVariant: Record<string, 'default' | 'destructive' | 'secondary'> = {
  active: 'default',
  suspended: 'destructive',
  pending_verification: 'secondary',
};

export function UserTable({ users }: UserTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <Link
                href={`/users/${user.id}`}
                className="font-mono text-xs font-medium text-primary hover:underline"
              >
                {user.email}
              </Link>
            </TableCell>
            <TableCell>{user.displayName}</TableCell>
            <TableCell>
              <Badge variant={statusVariant[user.status] ?? 'default'}>
                {user.status.replace('_', ' ')}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {new Date(user.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
        {users.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              No users found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
