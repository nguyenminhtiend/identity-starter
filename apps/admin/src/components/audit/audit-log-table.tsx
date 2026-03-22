import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AuditLogEntry } from '@/types/admin';

interface AuditLogTableProps {
  entries: AuditLogEntry[];
}

export function AuditLogTable({ entries }: AuditLogTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap font-mono text-xs">
              {new Date(entry.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">
                {entry.action}
              </Badge>
            </TableCell>
            <TableCell className="text-xs">
              <span className="text-muted-foreground">{entry.resourceType}</span>
              {entry.resourceId ? (
                <span className="ml-1 font-mono">{entry.resourceId.slice(0, 8)}...</span>
              ) : null}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {entry.actorId ? `${entry.actorId.slice(0, 8)}...` : 'system'}
            </TableCell>
            <TableCell className="font-mono text-xs">{entry.ipAddress ?? '\u2014'}</TableCell>
          </TableRow>
        ))}
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No audit log entries found.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
