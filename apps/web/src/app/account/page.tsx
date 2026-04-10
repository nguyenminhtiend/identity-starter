import { AccountProfile } from '@/components/account/account-profile';
import { PasskeyManager } from '@/components/account/passkey-manager';
import { serverFetch } from '@/lib/api-client';

interface Profile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: string;
  createdAt: string;
}

export default async function AccountPage() {
  const profile = await serverFetch<Profile>('/api/account/profile');

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md space-y-6">
        <AccountProfile profile={profile} />
        <PasskeyManager />
      </div>
    </div>
  );
}
