import { redirect } from 'next/navigation';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import { serverFetch } from '@/lib/api-client';
import type { AdminProfile } from '@/types/admin';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let profile: AdminProfile;
  try {
    const basicProfile = await serverFetch<{ id: string; email: string; displayName: string }>(
      '/api/account/profile',
    );
    const detail = await serverFetch<{ roles: Array<{ id: string; name: string }> }>(
      `/api/admin/users/${basicProfile.id}`,
    );
    profile = { ...basicProfile, roles: detail.roles };
  } catch {
    redirect('/login');
  }

  const isAdmin = profile.roles.some((r) => r.name === 'admin' || r.name === 'super_admin');

  if (!isAdmin) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar displayName={profile.displayName} email={profile.email} />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
