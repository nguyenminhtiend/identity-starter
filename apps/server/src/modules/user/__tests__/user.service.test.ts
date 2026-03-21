import mitt from 'mitt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserEvents } from '../user.events.js';
import type { UserRepository } from '../user.repository.js';
import { UserService } from '../user.service.js';
import type { User } from '../user.types.js';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-id',
    email: 'test@example.com',
    emailVerified: false,
    passwordHash: null,
    displayName: 'Test User',
    status: 'pending_verification',
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function createMockRepo(): {
  [K in keyof UserRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };
}

describe('UserService', () => {
  let service: UserService;
  let repo: ReturnType<typeof createMockRepo>;
  let eventBus: ReturnType<typeof mitt<UserEvents>>;

  beforeEach(() => {
    repo = createMockRepo();
    eventBus = mitt<UserEvents>();
    service = new UserService(repo as unknown as UserRepository, eventBus);
  });

  describe('create', () => {
    it('should create a user and emit event', async () => {
      const user = makeUser();
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const emitted: UserEvents['user.created'][] = [];
      eventBus.on('user.created', (e) => emitted.push(e));

      const result = await service.create({
        email: 'test@example.com',
        displayName: 'Test User',
        metadata: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe('test@example.com');
      }
      expect(emitted).toHaveLength(1);
    });

    it('should return error if email already exists', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());

      const result = await service.create({
        email: 'test@example.com',
        displayName: 'Test User',
        metadata: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFLICT');
      }
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      repo.findById.mockResolvedValue(makeUser());

      const result = await service.findById('test-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('test-id');
      }
    });

    it('should return error when not found', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    it('should update user and emit event', async () => {
      const updated = makeUser({ displayName: 'Updated' });
      repo.update.mockResolvedValue(updated);

      const emitted: UserEvents['user.updated'][] = [];
      eventBus.on('user.updated', (e) => emitted.push(e));

      const result = await service.update('test-id', { displayName: 'Updated' });

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
    });

    it('should return error if email conflicts', async () => {
      repo.findByEmail.mockResolvedValue(makeUser({ id: 'other-id' }));

      const result = await service.update('test-id', { email: 'test@example.com' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFLICT');
      }
    });
  });

  describe('delete', () => {
    it('should delete user and emit event', async () => {
      repo.delete.mockResolvedValue(true);

      const emitted: UserEvents['user.deleted'][] = [];
      eventBus.on('user.deleted', (e) => emitted.push(e));

      const result = await service.delete('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
    });

    it('should return error when not found', async () => {
      repo.delete.mockResolvedValue(false);

      const result = await service.delete('missing');

      expect(result.ok).toBe(false);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      repo.list.mockResolvedValue({ data: [makeUser()], total: 1 });

      const result = await service.list({ page: 1, pageSize: 20 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.data).toHaveLength(1);
        expect(result.value.totalPages).toBe(1);
      }
    });
  });

  describe('suspend', () => {
    it('should suspend user and emit event', async () => {
      repo.update.mockResolvedValue(makeUser({ status: 'suspended' }));

      const emitted: UserEvents['user.suspended'][] = [];
      eventBus.on('user.suspended', (e) => emitted.push(e));

      const result = await service.suspend('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
    });
  });

  describe('activate', () => {
    it('should activate user and emit event', async () => {
      repo.update.mockResolvedValue(makeUser({ status: 'active' }));

      const emitted: UserEvents['user.activated'][] = [];
      eventBus.on('user.activated', (e) => emitted.push(e));

      const result = await service.activate('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email and emit event', async () => {
      repo.update.mockResolvedValue(makeUser({ emailVerified: true }));

      const emitted: UserEvents['user.email_verified'][] = [];
      eventBus.on('user.email_verified', (e) => emitted.push(e));

      const result = await service.verifyEmail('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
    });
  });
});
