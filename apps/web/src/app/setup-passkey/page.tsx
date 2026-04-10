import { SetupPasskeyPrompt } from '@/components/auth/setup-passkey-prompt';

export default function SetupPasskeyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md">
        <SetupPasskeyPrompt />
      </div>
    </div>
  );
}
