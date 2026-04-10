'use client';

import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
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

const DISMISSED_KEY = 'passkey-prompt-dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // storage unavailable
  }
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'NotAllowedError' || error.name === 'AbortError';
}

interface PasskeyItem {
  id: string;
}

export function SetupPasskeyPrompt() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';

  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => clientFetch<PasskeyItem[]>('/api/account/passkeys'),
  });

  const shouldSkip = isDismissed() || (passkeysQuery.data && passkeysQuery.data.length > 0);

  useEffect(() => {
    if (shouldSkip) {
      router.replace(callbackUrl);
    }
  }, [shouldSkip, callbackUrl, router]);

  const registerMutation = useMutation({
    mutationFn: async () => {
      const options = await clientFetch<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkeys/register/options',
        { method: 'POST' },
      );

      const { startRegistration } = await import('@simplewebauthn/browser');
      let credential: RegistrationResponseJSON;
      try {
        credential = await startRegistration({ optionsJSON: options });
      } catch (error) {
        if (isCancellation(error)) {
          return null;
        }
        throw error;
      }

      await clientFetch('/api/auth/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
      });

      return true;
    },
    onSuccess: (result) => {
      if (result) {
        toast.success('Passkey registered');
        router.replace(callbackUrl);
      }
    },
  });

  function handleSkip() {
    setDismissed();
    router.replace(callbackUrl);
  }

  if (passkeysQuery.isLoading || shouldSkip) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Sign in faster with a passkey</CardTitle>
        <CardDescription>
          Passkeys use your fingerprint, face, or screen lock to sign you in securely — no password
          needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {registerMutation.error ? <ApiErrorAlert error={registerMutation.error} /> : null}
        <LoadingButton
          className="w-full"
          loading={registerMutation.isPending}
          onClick={() => registerMutation.mutate()}
        >
          Create a passkey
        </LoadingButton>
      </CardContent>
      <CardFooter>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={handleSkip}
          disabled={registerMutation.isPending}
        >
          Not now
        </Button>
      </CardFooter>
    </Card>
  );
}
