'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { clientFetch } from '@/lib/api-client';

interface Profile {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: string;
  createdAt: string;
}

export function AccountProfile({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await clientFetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{profile.displayName}</CardTitle>
        <CardDescription>{profile.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{profile.status.replace(/_/g, ' ')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Email verified</dt>
            <dd>{profile.emailVerified ? 'Yes' : 'No'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Member since</dt>
            <dd>{new Date(profile.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={handleLogout} disabled={loggingOut}>
          <LogOut className="mr-2 h-4 w-4" />
          {loggingOut ? 'Logging out...' : 'Log out'}
        </Button>
      </CardFooter>
    </Card>
  );
}
