'use client';

import { Download, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function AuditLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  function handleActionSearch(value: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => updateParams('action', value), 300);
  }

  function clearFilters() {
    router.push(pathname);
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams(searchParams.toString());
      const response = await fetch(`/api/admin/audit-logs/export?${params.toString()}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('Export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.ndjson`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export audit logs');
    }
  }

  const hasFilters = searchParams.has('action') || searchParams.has('resourceType');

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by action..."
          defaultValue={searchParams.get('action') ?? ''}
          onChange={(e) => handleActionSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        value={searchParams.get('resourceType') ?? ''}
        onValueChange={(v) => updateParams('resourceType', v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All resources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All resources</SelectItem>
          <SelectItem value="user">User</SelectItem>
          <SelectItem value="session">Session</SelectItem>
          <SelectItem value="role">Role</SelectItem>
          <SelectItem value="client">OAuth Client</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button variant="ghost" size="icon" onClick={clearFilters}>
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="mr-2 h-4 w-4" />
        Export
      </Button>
    </div>
  );
}
