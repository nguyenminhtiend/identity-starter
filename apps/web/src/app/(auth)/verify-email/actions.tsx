'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { clientFetch } from '@/lib/api-client';

interface VerifyEmailActionsProps {
  token?: string;
}

export function VerifyEmailActions({ token }: VerifyEmailActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    clientFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus('success');
        setTimeout(() => {
          router.push('/account');
          router.refresh();
        }, 2000);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token, router]);

  async function handleResend() {
    setResending(true);
    try {
      await clientFetch('/api/auth/resend-verification', { method: 'POST' });
      toast.success('Verification email sent');
    } catch {
      toast.error('Failed to resend verification email');
    } finally {
      setResending(false);
    }
  }

  if (status === 'verifying') {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'success') {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>Email verified! Redirecting...</AlertDescription>
      </Alert>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button onClick={handleResend} disabled={resending} className="w-full">
          {resending ? 'Sending...' : 'Resend verification email'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">Didn&apos;t receive an email?</p>
      <Button onClick={handleResend} disabled={resending} variant="outline" className="w-full">
        {resending ? 'Sending...' : 'Resend verification email'}
      </Button>
    </div>
  );
}
