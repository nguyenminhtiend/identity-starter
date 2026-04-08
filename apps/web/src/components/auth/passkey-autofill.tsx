'use client';

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { clientFetch } from '@/lib/api-client';
import type { AuthResponse } from '@/types/api';

interface PasskeyAutofillProps {
  callbackUrl: string;
}

export function PasskeyAutofill({ callbackUrl }: PasskeyAutofillProps) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function startConditionalUI() {
      const { browserSupportsWebAuthnAutofill, startAuthentication } = await import(
        '@simplewebauthn/browser'
      );

      const supported = await browserSupportsWebAuthnAutofill();
      if (!supported || cancelled) {
        return;
      }

      try {
        const options = await clientFetch<PublicKeyCredentialRequestOptionsJSON>(
          '/api/auth/passkeys/login/options',
          { method: 'POST' },
        );

        if (cancelled) {
          return;
        }

        const credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });

        if (cancelled) {
          return;
        }

        await clientFetch<AuthResponse>('/api/auth/passkeys/login/verify', {
          method: 'POST',
          body: JSON.stringify(credential),
        });

        router.push(callbackUrl);
      } catch {
        // User cancelled or browser doesn't support — fail silently
      }
    }

    void startConditionalUI();

    return () => {
      cancelled = true;
    };
  }, [callbackUrl, router]);

  return null;
}
