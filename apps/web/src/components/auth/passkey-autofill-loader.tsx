'use client';

import dynamic from 'next/dynamic';

const PasskeyAutofill = dynamic(
  () => import('./passkey-autofill').then((m) => ({ default: m.PasskeyAutofill })),
  { ssr: false },
);

interface PasskeyAutofillLoaderProps {
  callbackUrl: string;
}

export function PasskeyAutofillLoader({ callbackUrl }: PasskeyAutofillLoaderProps) {
  return <PasskeyAutofill callbackUrl={callbackUrl} />;
}
