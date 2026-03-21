import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '../../../infra/event-bus.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { USER_EVENTS } from '../user.events.js';
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

function collectEvents(eventBus: InMemoryEventBus, eventName: string): DomainEvent[] {
  const collected: DomainEvent[] = [];
  eventBus.subscribe(eventName, (e) => {
    collected.push(e);
  });
  return collected;
}

describe('UserService', () => {
  let service: UserService;
  let repo: ReturnType<typeof createMockRepo>;
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    repo = createMockRepo();
    eventBus = new InMemoryEventBus();
    service = new UserService(repo as unknown as UserRepository, eventBus);
  });

  describe('create', () => {
    it('should create a user and publish event', async () => {
      const user = makeUser();
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const emitted = collectEvents(eventBus, USER_EVENTS.CREATED);

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
      expect(emitted[0].eventName).toBe(USER_EVENTS.CREATED);
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
    it('should update user and publish event', async () => {
      const updated = makeUser({ displayName: 'Updated' });
      repo.update.mockResolvedValue(updated);

      const emitted = collectEvents(eventBus, USER_EVENTS.UPDATED);

      const result = await service.update('test-id', { displayName: 'Updated' });

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventName).toBe(USER_EVENTS.UPDATED);
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
    it('should delete user and publish event', async () => {
      repo.delete.mockResolvedValue(true);

      const emitted = collectEvents(eventBus, USER_EVENTS.DELETED);

      const result = await service.delete('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventName).toBe(USER_EVENTS.DELETED);
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
    it('should suspend user and publish event', async () => {
      repo.update.mockResolvedValue(makeUser({ status: 'suspended' }));

      const emitted = collectEvents(eventBus, USER_EVENTS.SUSPENDED);

      const result = await service.suspend('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventName).toBe(USER_EVENTS.SUSPENDED);
    });
  });

  describe('activate', () => {
    it('should activate user and publish event', async () => {
      repo.update.mockResolvedValue(makeUser({ status: 'active' }));

      const emitted = collectEvents(eventBus, USER_EVENTS.ACTIVATED);

      const result = await service.activate('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventName).toBe(USER_EVENTS.ACTIVATED);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email and publish event', async () => {
      repo.update.mockResolvedValue(makeUser({ emailVerified: true }));

      const emitted = collectEvents(eventBus, USER_EVENTS.EMAIL_VERIFIED);

      const result = await service.verifyEmail('test-id');

      expect(result.ok).toBe(true);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventName).toBe(USER_EVENTS.EMAIL_VERIFIED);
    });
  });
});
