import { BASE_URL } from './constants.js';

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
  query?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

async function request<T = unknown>(
  method: string,
  path: string,
  options?: RequestOptions,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = { ...options?.headers };

  if (options?.body) {
    headers['content-type'] = 'application/json';
  }

  if (options?.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });

  let data: T;
  const is3xx = response.status >= 300 && response.status < 400;
  if (response.status === 204 || is3xx) {
    data = null as T;
  } else {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }
  }

  return { status: response.status, headers: response.headers, data };
}

export const api = {
  get: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  patch: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
  put: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
  delete: <T = unknown>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
