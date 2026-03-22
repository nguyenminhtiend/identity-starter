import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Account Management', () => {
  const email = uniqueEmail('account');
  let sessionToken: string;

  it('registers and logs in', async () => {
    const regRes = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Account E2E User' },
    });
    expect(regRes.status).toBe(201);
    sessionToken = regRes.data.token;
  });

  describe('profile', () => {
    it('gets profile', async () => {
      const res = await api.get<{ id: string; email: string; displayName: string }>(
        '/api/account/profile',
        { token: sessionToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.email).toBe(email);
      expect(res.data.displayName).toBe('Account E2E User');
    });

    it('rejects profile without auth', async () => {
      const res = await api.get('/api/account/profile');
      expect(res.status).toBe(401);
    });

    it('updates display name', async () => {
      const res = await api.patch<{ displayName: string }>('/api/account/profile', {
        body: { displayName: 'Updated E2E Name' },
        token: sessionToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.displayName).toBe('Updated E2E Name');
    });
  });

  describe('sessions', () => {
    it('creates a second session and lists them', async () => {
      await api.post('/api/auth/login', { body: { email, password: TEST_PASSWORD } });

      const res = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.filter((s) => s.isCurrent)).toHaveLength(1);
    });

    it('rejects deleting current session', async () => {
      const listRes = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );
      const current = listRes.data.find((s) => s.isCurrent);
      if (!current) {
        throw new Error('expected a current session');
      }

      const res = await api.delete(`/api/account/sessions/${current.id}`, {
        token: sessionToken,
      });
      expect(res.status).toBe(400);
    });

    it('deletes another session', async () => {
      const listRes = await api.get<Array<{ id: string; isCurrent: boolean }>>(
        '/api/account/sessions',
        { token: sessionToken },
      );
      const other = listRes.data.find((s) => !s.isCurrent);
      if (!other) {
        throw new Error('expected a non-current session');
      }

      const res = await api.delete(`/api/account/sessions/${other.id}`, {
        token: sessionToken,
      });
      expect(res.status).toBe(204);
    });
  });

  describe('passkey options (no WebAuthn ceremony)', () => {
    it('gets registration options', async () => {
      const res = await api.post('/api/auth/passkeys/register/options', {
        token: sessionToken,
      });

      expect(res.status).toBe(200);
    });

    it('gets login options (no auth required)', async () => {
      const res = await api.post('/api/auth/passkeys/login/options');

      expect(res.status).toBe(200);
    });

    it('lists passkeys (empty for new user)', async () => {
      const res = await api.get<unknown[]>('/api/account/passkeys', { token: sessionToken });

      expect(res.status).toBe(200);
      expect(res.data).toEqual([]);
    });
  });
});
