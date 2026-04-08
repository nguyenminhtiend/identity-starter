import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ConsentForm } from '@/components/oauth/consent-form';
import type { ConsentRequired } from '@/types/oauth';

interface AuthorizePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function fetchConsentData(
  queryString: string,
): Promise<ConsentRequired | { type: 'redirect'; location: string }> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session');
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  const response = await fetch(`${apiUrl}/oauth/authorize?${queryString}`, {
    headers: session ? { Authorization: `Bearer ${session.value}` } : {},
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      return { type: 'redirect', location };
    }
    throw new Error('Redirect with no location');
  }

  if (response.status === 401) {
    return { type: 'session_expired' as const };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Authorization failed');
  }

  return response.json();
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const rawParams = await searchParams;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      params[key] = value[0];
    }
  }
  const queryString = new URLSearchParams(params).toString();

  const cookieStore = await cookies();
  if (!cookieStore.get('session')) {
    const callbackUrl = `/oauth/authorize?${queryString}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  let response:
    | ConsentRequired
    | { type: 'redirect'; location: string }
    | { type: 'session_expired' };
  try {
    response = await fetchConsentData(queryString);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authorization failed';
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-destructive">{message}</p>
      </div>
    );
  }

  if (response.type === 'session_expired') {
    const cookieStore2 = await cookies();
    cookieStore2.delete('session');
    const callbackUrl = `/oauth/authorize?${queryString}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  if (response.type === 'redirect') {
    redirect(response.location);
  }

  if (response.type !== 'consent_required') {
    redirect('/account');
  }

  return <ConsentForm data={response} authorizeParams={params} />;
}
