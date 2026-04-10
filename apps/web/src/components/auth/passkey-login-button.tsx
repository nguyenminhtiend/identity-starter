'use client';

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { LoadingButton } from '@/components/shared/loading-button';
import { clientFetch } from '@/lib/api-client';
import { type AuthResponse, isMfaChallenge, type LoginResponse } from '@/types/api';

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'NotAllowedError' || error.name === 'AbortError';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Passkey sign-in failed';
}

export function PasskeyLoginButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';

  const mutation = useMutation({
    mutationFn: async (): Promise<LoginResponse | null> => {
      const options = await clientFetch<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkeys/login/options',
        { method: 'POST' },
      );

      const { startAuthentication } = await import('@simplewebauthn/browser');
      let credential: Awaited<ReturnType<typeof startAuthentication>>;
      try {
        credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: false,
        });
      } catch (error) {
        if (isCancellation(error)) {
          return null;
        }
        throw error;
      }

      return clientFetch<AuthResponse>('/api/auth/passkeys/login/verify', {
        method: 'POST',
        body: JSON.stringify(credential),
      });
    },
    onSuccess: (data) => {
      if (!data) {
        return;
      }
      if (isMfaChallenge(data)) {
        router.push(`/mfa?token=${data.mfaToken}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        router.push(callbackUrl);
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  return (
    <LoadingButton
      type="button"
      variant="outline"
      className="w-full"
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <KeyRound className="mr-2 h-4 w-4" />
      Sign in with a passkey
    </LoadingButton>
  );
}
