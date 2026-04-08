'use client';

import { FileText, LogOut, Monitor, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/users', label: 'Users', icon: Users },
  { href: '/roles', label: 'Roles', icon: ShieldCheck },
  { href: '/sessions', label: 'Sessions', icon: Monitor },
  { href: '/audit-logs', label: 'Audit Logs', icon: FileText },
];

interface AdminSidebarProps {
  displayName: string;
  email: string;
}

export function AdminSidebar({ displayName, email }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    // Navigate to IdP end-session so its session cookie is cleared too —
    // otherwise /auth/login would immediately SSO the user back in.
    try {
      const { endSessionUrl } = (await response.json()) as { endSessionUrl?: string };
      if (endSessionUrl) {
        window.location.href = endSessionUrl;
        return;
      }
    } catch {
      // fall through to local redirect
    }
    router.push('/auth/login');
    router.refresh();
  }

  return (
    <aside className="hidden w-56 border-r bg-card lg:flex lg:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/users" className="text-sm font-semibold tracking-tight">
          Identity Admin
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              pathname.startsWith(item.href)
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 px-3">
          <p className="text-xs font-medium">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
