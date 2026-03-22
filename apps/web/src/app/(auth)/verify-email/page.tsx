import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyEmailActions } from './actions';

interface VerifyEmailPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="font-display text-2xl">Verify your email</CardTitle>
        <CardDescription>
          {token ? 'Verifying your email address...' : 'Check your inbox for a verification link'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyEmailActions token={token} />
      </CardContent>
    </Card>
  );
}
