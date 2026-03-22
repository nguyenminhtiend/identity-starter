import type { ApiErrorBody } from '../types/api.js';

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public body: ApiErrorBody,
  ) {
    super(body.error);
    this.name = 'ApiRequestError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    throw new ApiRequestError(response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

/**
 * Server-side fetch — reads session cookie and forwards as Bearer token.
 * Use in Server Components and Route Handlers.
 *
 * Reads API_URL from process.env (set by the consuming Next.js app).
 */
export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const session = cookieStore.get('session');

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.value}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  return handleResponse<T>(response);
}

/**
 * Client-side fetch — browser sends cookies automatically via same-origin rewrites.
 * Use in Client Components with TanStack Query mutations.
 */
export async function clientFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  return handleResponse<T>(response);
}
