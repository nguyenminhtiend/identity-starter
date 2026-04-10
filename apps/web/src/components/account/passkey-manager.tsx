'use client';

import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert } from '@/components/shared/api-error-alert';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LoadingButton } from '@/components/shared/loading-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { clientFetch } from '@/lib/api-client';

interface PasskeyItem {
  id: string;
  credentialId: string;
  deviceType: string;
  backedUp: boolean;
  name: string | null;
  createdAt: string;
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'NotAllowedError' || error.name === 'AbortError';
}

function PasskeyRow({
  passkey,
  onRenamed,
  onDeleted,
}: {
  passkey: PasskeyItem;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      clientFetch(`/api/account/passkeys/${passkey.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setEditing(false);
      onRenamed();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => clientFetch(`/api/account/passkeys/${passkey.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Passkey deleted');
      onDeleted();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function handleRenameSubmit() {
    const value = inputRef.current?.value.trim();
    if (!value) {
      setEditing(false);
      return;
    }
    renameMutation.mutate(value);
  }

  const displayName = passkey.name ?? `Passkey (${passkey.credentialId.slice(0, 8)}...)`;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRenameSubmit();
            }}
            className="flex items-center gap-2"
          >
            <Input
              ref={inputRef}
              defaultValue={passkey.name ?? ''}
              placeholder="Passkey name"
              className="h-7 text-sm"
              autoFocus
              disabled={renameMutation.isPending}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={renameMutation.isPending}
            >
              Save
            </Button>
          </form>
        ) : (
          <>
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="text-xs text-muted-foreground">
              {passkey.deviceType === 'multiDevice' ? 'Synced' : 'Device-bound'}
              {' · '}
              {new Date(passkey.createdAt).toLocaleDateString()}
            </p>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            }
            title="Delete passkey"
            description="This passkey will be permanently removed. You won't be able to sign in with it anymore."
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={() => deleteMutation.mutate()}
          />
        </div>
      )}
    </div>
  );
}

export function PasskeyManager() {
  const queryClient = useQueryClient();

  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => clientFetch<PasskeyItem[]>('/api/account/passkeys'),
  });

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
        queryClient.invalidateQueries({ queryKey: ['passkeys'] });
      }
    },
  });

  function invalidatePasskeys() {
    queryClient.invalidateQueries({ queryKey: ['passkeys'] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Passkeys
        </CardTitle>
        <CardDescription>
          Register a passkey to sign in without a password using your device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {registerMutation.error ? <ApiErrorAlert error={registerMutation.error} /> : null}

        {passkeysQuery.data && passkeysQuery.data.length > 0 && (
          <div className="space-y-2">
            {passkeysQuery.data.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                onRenamed={invalidatePasskeys}
                onDeleted={invalidatePasskeys}
              />
            ))}
          </div>
        )}

        <LoadingButton
          type="button"
          className="w-full"
          loading={registerMutation.isPending}
          onClick={() => registerMutation.mutate()}
        >
          Register a passkey
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
