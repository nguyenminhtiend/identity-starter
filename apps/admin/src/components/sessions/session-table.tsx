'use client';

import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { clientFetch } from '@/lib/api-client';
import type { AdminSession } from '@/types/admin';

interface SessionTableProps {
  sessions: AdminSession[];
}

export function SessionTable({ sessions }: SessionTableProps) {
  const router = useRouter();

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      clientFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Session revoked');
      router.refresh();
    },
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User ID</TableHead>
          <TableHead>IP Address</TableHead>
          <TableHead>User Agent</TableHead>
          <TableHead>Last Active</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell className="font-mono text-xs">{session.userId.slice(0, 8)}...</TableCell>
            <TableCell className="font-mono text-xs">{session.ipAddress ?? '\u2014'}</TableCell>
            <TableCell className="max-w-48 truncate text-xs">
              {session.userAgent ?? '\u2014'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {new Date(session.lastActiveAt).toLocaleString()}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {new Date(session.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(session.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {sessions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              No sessions found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
