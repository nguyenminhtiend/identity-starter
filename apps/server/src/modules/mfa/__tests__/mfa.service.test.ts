import { createHmac } from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@identity-starter/core';
import * as OTPAuth from 'otpauth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../../core/crypto.js';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb, selectChain, selectFromWhereRows } from '../../../test/mock-db.js';
import { MFA_EVENTS } from '../mfa.events.js';

vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:5432/unit_test');

const mockEnvState = vi.hoisted(() => ({
  TOTP_ENCRYPTION_KEY: 'a'.repeat(64) as string | undefined,
  WEBAUTHN_RP_NAME: 'Test Issuer',
}));

vi.mock('../../../core/env.js', () => ({
  get env() {
    return mockEnvState;
  },
}));

const mockVerifyPassword = vi.fn();

vi.mock('../../../core/password.js', () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

vi.mock('../../session/session.service.js', () => ({
  createSession: vi.fn(() =>
    Promise.resolve({
      id: '550e8400-e29b-41d4-a716-446655440099',
      token: 'raw-session-token',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    }),
  ),
}));

import { createSession } from '../../session/session.service.js';
import {
  checkMfaEnrolled,
  disableTotp,
  enrollTotp,
  generateRecoveryCodesRaw,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
  verifyTotpEnrollment,
} from '../mfa.service.js';

const userId = '550e8400-e29b-41d4-a716-446655440000';

function userRow() {
  return {
    id: userId,
    email: 'u@example.com',
    emailVerified: true,
    displayName: 'User',
    status: 'active' as const,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

afterEach(() => {
  mockEnvState.TOTP_ENCRYPTION_KEY = 'a'.repeat(64);
});

describe('generateRecoveryCodesRaw', () => {
  it('returns 8 codes in XXXX-XXXX shape using allowed charset', () => {
    const codes = generateRecoveryCodesRaw();
    expect(codes).toHaveLength(8);
    const pattern = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    for (const c of codes) {
      expect(c).toMatch(pattern);
    }
  });
});

describe('enrollTotp', () => {
  it('throws ValidationError when TOTP_ENCRYPTION_KEY is missing', async () => {
    mockEnvState.TOTP_ENCRYPTION_KEY = undefined;
    const db = createMockDb({});
    await expect(enrollTotp(db, userId)).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when user is missing', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    await expect(enrollTotp(db, userId)).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when verified TOTP already exists', async () => {
    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([userRow()]))
        .mockReturnValueOnce(selectChain([{ id: 'existing' }])),
    });
    await expect(enrollTotp(db, userId)).rejects.toThrow(ConflictError);
  });

  it('deletes unverified secrets, inserts TOTP and recovery rows on success', async () => {
    const valuesSpy = vi.fn().mockResolvedValue(undefined);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([userRow()]))
        .mockReturnValueOnce(selectChain([])),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      insert: vi.fn().mockReturnValue({ values: valuesSpy }),
    });

    const result = await enrollTotp(db, userId);

    expect(result.otpauthUri).toContain('otpauth://');
    expect(result.recoveryCodes).toHaveLength(8);
    expect(deleteWhere).toHaveBeenCalled();
    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        verified: false,
      }),
    );
    const key = mockEnvState.TOTP_ENCRYPTION_KEY ?? '';
    for (const code of result.recoveryCodes) {
      const expected = createHmac('sha256', key).update(code).digest('hex');
      expect(
        valuesSpy.mock.calls.some((c) => (c[0] as { codeHash?: string }).codeHash === expected),
      ).toBe(true);
    }
  });
});

describe('verifyTotpEnrollment', () => {
  it('throws NotFoundError when no unverified secret', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    const eventBus = new InMemoryEventBus();
    await expect(verifyTotpEnrollment(db, eventBus, userId, '123456')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws UnauthorizedError on invalid OTP', async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const enc = encrypt(secret.hex, mockEnvState.TOTP_ENCRYPTION_KEY ?? '');
    const db = createMockDb({
      select: vi.fn().mockReturnValue(
        selectChain([
          {
            id: 'totp-1',
            userId,
            secret: enc,
            verified: false,
            createdAt: new Date(),
          },
        ]),
      ),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(verifyTotpEnrollment(db, eventBus, userId, '000000')).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('updates verified flag and emits event on valid OTP', async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const enc = encrypt(secret.hex, mockEnvState.TOTP_ENCRYPTION_KEY ?? '');
    const totp = new OTPAuth.TOTP({
      issuer: '',
      label: '',
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const otp = totp.generate();

    const whereSpy = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      select: vi.fn().mockReturnValue(
        selectChain([
          {
            id: 'totp-1',
            userId,
            secret: enc,
            verified: false,
            createdAt: new Date(),
          },
        ]),
      ),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: whereSpy,
        }),
      }),
    });
    const eventBus = new InMemoryEventBus();
    const events: string[] = [];
    eventBus.subscribe(MFA_EVENTS.TOTP_ENROLLED, () => {
      events.push(MFA_EVENTS.TOTP_ENROLLED);
    });

    await verifyTotpEnrollment(db, eventBus, userId, otp);

    expect(whereSpy).toHaveBeenCalled();
    expect(events).toContain(MFA_EVENTS.TOTP_ENROLLED);
  });
});

describe('disableTotp', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
  });

  it('throws UnauthorizedError when password is wrong', async () => {
    mockVerifyPassword.mockResolvedValue(false);
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([{ id: userId, passwordHash: '$argon2$hash' }])),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(disableTotp(db, eventBus, userId, 'wrong')).rejects.toThrow(UnauthorizedError);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes secrets and codes and emits when password valid', async () => {
    mockVerifyPassword.mockResolvedValue(true);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([{ id: userId, passwordHash: '$argon2$hash' }])),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    });
    const eventBus = new InMemoryEventBus();
    const names: string[] = [];
    eventBus.subscribe(MFA_EVENTS.TOTP_DISABLED, () => {
      names.push(MFA_EVENTS.TOTP_DISABLED);
    });

    await disableTotp(db, eventBus, userId, 'good-password');

    expect(mockVerifyPassword).toHaveBeenCalledWith('$argon2$hash', 'good-password');
    expect(deleteWhere).toHaveBeenCalled();
    expect(names).toContain(MFA_EVENTS.TOTP_DISABLED);
  });
});

describe('regenerateRecoveryCodes', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
  });

  it('throws ValidationError when verified TOTP missing', async () => {
    mockVerifyPassword.mockResolvedValue(true);
    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: userId, passwordHash: '$h' }]))
        .mockReturnValueOnce(selectChain([])),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(regenerateRecoveryCodes(db, eventBus, userId, 'pw')).rejects.toThrow(
      ValidationError,
    );
  });

  it('replaces codes and emits when TOTP enrolled', async () => {
    mockVerifyPassword.mockResolvedValue(true);
    const valuesSpy = vi.fn().mockResolvedValue(undefined);
    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: userId, passwordHash: '$h' }]))
        .mockReturnValueOnce(selectChain([{ id: 'totp' }])),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      insert: vi.fn().mockReturnValue({ values: valuesSpy }),
    });
    const eventBus = new InMemoryEventBus();
    const names: string[] = [];
    eventBus.subscribe(MFA_EVENTS.RECOVERY_CODES_GENERATED, () => {
      names.push(MFA_EVENTS.RECOVERY_CODES_GENERATED);
    });

    const codes = await regenerateRecoveryCodes(db, eventBus, userId, 'pw');

    expect(codes).toHaveLength(8);
    const key = mockEnvState.TOTP_ENCRYPTION_KEY ?? '';
    for (const code of codes) {
      const expected = createHmac('sha256', key).update(code).digest('hex');
      expect(
        valuesSpy.mock.calls.some((c) => (c[0] as { codeHash?: string }).codeHash === expected),
      ).toBe(true);
    }
    expect(names).toContain(MFA_EVENTS.RECOVERY_CODES_GENERATED);
  });
});

describe('checkMfaEnrolled', () => {
  it('returns false when no verified row', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    await expect(checkMfaEnrolled(db, userId)).resolves.toBe(false);
  });

  it('returns true when verified row exists', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([{ id: 't' }])),
    });
    await expect(checkMfaEnrolled(db, userId)).resolves.toBe(true);
  });
});

describe('verifyMfaChallenge', () => {
  beforeEach(() => {
    vi.mocked(createSession).mockClear();
  });

  it('throws ValidationError when both otp and recoveryCode provided', async () => {
    const db = createMockDb({});
    const eventBus = new InMemoryEventBus();
    await expect(
      verifyMfaChallenge(
        db,
        eventBus,
        { mfaToken: 't', otp: '123456', recoveryCode: 'ABCD-EFGH' },
        {},
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when neither otp nor recoveryCode provided', async () => {
    const db = createMockDb({});
    const eventBus = new InMemoryEventBus();
    await expect(verifyMfaChallenge(db, eventBus, { mfaToken: 't' }, {})).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws UnauthorizedError when challenge missing or expired', async () => {
    const db = createMockDb({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    const eventBus = new InMemoryEventBus();
    await expect(
      verifyMfaChallenge(db, eventBus, { mfaToken: 'bad', otp: '123456' }, {}),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError on invalid OTP', async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const enc = encrypt(secret.hex, mockEnvState.TOTP_ENCRYPTION_KEY ?? '');
    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'ch-1',
              userId,
              token: 'mfa-tok',
              expiresAt: new Date(Date.now() + 60_000),
              usedAt: null,
              createdAt: new Date(),
            },
          ]),
        )
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'totp-1',
              userId,
              secret: enc,
              verified: true,
              createdAt: new Date(),
            },
          ]),
        ),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(
      verifyMfaChallenge(db, eventBus, { mfaToken: 'mfa-tok', otp: '000000' }, {}),
    ).rejects.toThrow(UnauthorizedError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('completes OTP path: session, challenge marked used, event published', async () => {
    const secret = new OTPAuth.Secret({ size: 20 });
    const enc = encrypt(secret.hex, mockEnvState.TOTP_ENCRYPTION_KEY ?? '');
    const totp = new OTPAuth.TOTP({
      issuer: '',
      label: '',
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const otp = totp.generate();

    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'ch-1',
              userId,
              token: 'mfa-tok',
              expiresAt: new Date(Date.now() + 60_000),
              usedAt: null,
              createdAt: new Date(),
            },
          ]),
        )
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'totp-1',
              userId,
              secret: enc,
              verified: true,
              createdAt: new Date(),
            },
          ]),
        )
        .mockReturnValueOnce(selectChain([userRow()])),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    const eventBus = new InMemoryEventBus();
    const verified: string[] = [];
    eventBus.subscribe(MFA_EVENTS.TOTP_VERIFIED, () => {
      verified.push(MFA_EVENTS.TOTP_VERIFIED);
    });

    const result = await verifyMfaChallenge(
      db,
      eventBus,
      { mfaToken: 'mfa-tok', otp },
      { ipAddress: '127.0.0.1' },
    );

    expect(result.token).toBe('raw-session-token');
    expect(result.user.email).toBe('u@example.com');
    expect(createSession).toHaveBeenCalled();
    expect(verified).toContain(MFA_EVENTS.TOTP_VERIFIED);
  });

  it('consumes recovery code path and publishes RECOVERY_CODE_USED', async () => {
    const recoveryCode = 'CODE-HERE';
    const codeHash = createHmac('sha256', mockEnvState.TOTP_ENCRYPTION_KEY ?? '')
      .update(recoveryCode)
      .digest('hex');

    const db = createMockDb({
      select: vi
        .fn()
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'ch-1',
              userId,
              token: 'mfa-tok',
              expiresAt: new Date(Date.now() + 60_000),
              usedAt: null,
              createdAt: new Date(),
            },
          ]),
        )
        .mockReturnValueOnce(
          selectFromWhereRows([
            { id: 'rc-1', userId, codeHash: 'nomatch', usedAt: null, createdAt: new Date() },
            { id: 'rc-2', userId, codeHash, usedAt: null, createdAt: new Date() },
          ]),
        )
        .mockReturnValueOnce(selectFromWhereRows([{ n: 1n }]))
        .mockReturnValueOnce(selectChain([userRow()])),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const result = await verifyMfaChallenge(
      db,
      eventBus,
      { mfaToken: 'mfa-tok', recoveryCode },
      {},
    );

    expect(result.token).toBeDefined();
    const recoveryUsed = publishSpy.mock.calls.find(
      (c) =>
        (c[0] as DomainEvent<{ remaining: number }>).eventName === MFA_EVENTS.RECOVERY_CODE_USED,
    );
    expect(recoveryUsed).toBeDefined();
    if (!recoveryUsed) {
      throw new Error('expected RECOVERY_CODE_USED publish');
    }
    expect((recoveryUsed[0] as DomainEvent<{ remaining: number }>).payload.remaining).toBe(1);
  });
});
