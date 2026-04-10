import { type NextRequest, NextResponse } from 'next/server';
import { getCredentials } from '@/lib/api-client.server';
import { createDPoPProof } from '@/lib/dpop';
import { env } from '@/lib/env';

async function proxyWithDPoP(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const creds = await getCredentials();
  if (!creds) {
    return NextResponse.json({ error: 'Unauthorized', statusCode: 401 }, { status: 401 });
  }

  const { path } = await params;
  const backendPath = `/api/admin/${path.join('/')}`;
  const queryString = request.nextUrl.search;
  const fullUrl = `${env.API_URL}${backendPath}${queryString}`;
  const method = request.method;
  const htu = `${env.API_URL}${backendPath}`;

  const dpopProof = await createDPoPProof(creds.dpopKeyPair, method, htu, creds.accessToken);

  const headers: Record<string, string> = {
    Authorization: `DPoP ${creds.accessToken}`,
    DPoP: dpopProof,
  };

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const body = method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined;

  const backendResponse = await fetch(fullUrl, {
    method,
    headers,
    body,
  });

  const responseHeaders = new Headers();
  const passthroughHeaders = ['content-type', 'content-disposition'];
  for (const name of passthroughHeaders) {
    const value = backendResponse.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }

  const responseBody = await backendResponse.arrayBuffer();

  return new NextResponse(responseBody, {
    status: backendResponse.status,
    headers: responseHeaders,
  });
}

export const GET = proxyWithDPoP;
export const POST = proxyWithDPoP;
export const PUT = proxyWithDPoP;
export const PATCH = proxyWithDPoP;
export const DELETE = proxyWithDPoP;
