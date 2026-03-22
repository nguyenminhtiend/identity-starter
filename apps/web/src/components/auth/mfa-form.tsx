'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { LoadingButton } from '@/components/shared/loading-button';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { clientFetch } from '@/lib/api-client';
import type { MfaVerifyResponse } from '@/types/api';

const totpSchema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code'),
});

const recoverySchema = z.object({
  recoveryCode: z.string().min(1, 'Enter a recovery code'),
});

type TotpValues = z.infer<typeof totpSchema>;
type RecoveryValues = z.infer<typeof recoverySchema>;

export function MfaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mfaToken = searchParams.get('token') ?? '';
  const callbackUrl = searchParams.get('callbackUrl') ?? '/account';
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');

  const totpForm = useForm<TotpValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { otp: '' },
  });

  const recoveryForm = useForm<RecoveryValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  const totpMutation = useMutation({
    mutationFn: (values: TotpValues) =>
      clientFetch<MfaVerifyResponse>('/api/auth/mfa/totp/verify', {
        method: 'POST',
        body: JSON.stringify({ ...values, mfaToken }),
      }),
    onSuccess: () => {
      router.push(callbackUrl);
      router.refresh();
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: (values: RecoveryValues) =>
      clientFetch<MfaVerifyResponse>('/api/auth/mfa/recovery/verify', {
        method: 'POST',
        body: JSON.stringify({ ...values, mfaToken }),
      }),
    onSuccess: () => {
      router.push(callbackUrl);
      router.refresh();
    },
  });

  if (mode === 'recovery') {
    return (
      <Form {...recoveryForm}>
        <form
          onSubmit={recoveryForm.handleSubmit((v) => recoveryMutation.mutate(v))}
          className="space-y-4"
        >
          {recoveryMutation.error ? <ApiErrorAlert error={recoveryMutation.error} /> : null}

          <FormField
            control={recoveryForm.control}
            name="recoveryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recovery code</FormLabel>
                <FormControl>
                  <Input placeholder="xxxx-xxxx-xxxx" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton type="submit" className="w-full" loading={recoveryMutation.isPending}>
            Verify recovery code
          </LoadingButton>

          <Button type="button" variant="link" className="w-full" onClick={() => setMode('totp')}>
            Use authenticator app instead
          </Button>
        </form>
      </Form>
    );
  }

  return (
    <Form {...totpForm}>
      <form onSubmit={totpForm.handleSubmit((v) => totpMutation.mutate(v))} className="space-y-4">
        {totpMutation.error ? <ApiErrorAlert error={totpMutation.error} /> : null}

        <FormField
          control={totpForm.control}
          name="otp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Authentication code</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <LoadingButton type="submit" className="w-full" loading={totpMutation.isPending}>
          Verify
        </LoadingButton>

        <Button type="button" variant="link" className="w-full" onClick={() => setMode('recovery')}>
          Use a recovery code
        </Button>
      </form>
    </Form>
  );
}
