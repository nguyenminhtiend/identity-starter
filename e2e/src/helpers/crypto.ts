import { createHash, randomBytes } from 'node:crypto';

export function pkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function codeFromLocation(location: string): string {
  const url = new URL(location);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error(`No code in Location: ${location}`);
  }
  return code;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}@e2e.test`;
}
