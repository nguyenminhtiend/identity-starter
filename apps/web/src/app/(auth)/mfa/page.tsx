import { Suspense } from 'react';
import { MfaForm } from '@/components/auth/mfa-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function MfaPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Two-factor authentication</CardTitle>
        <CardDescription>Enter the code from your authenticator app</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <MfaForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
