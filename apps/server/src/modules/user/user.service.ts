import type { PaginatedResult, PaginationInput } from '@identity-starter/core';
import { ConflictError, err, NotFoundError, ok, type Result } from '@identity-starter/core';
import { nanoid } from 'nanoid';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { USER_EVENTS } from './user.events.js';
import type { UserRepository } from './user.repository.js';
import type { CreateUserInput, UpdateUserInput, User } from './user.types.js';

export class UserService {
  constructor(
    private repo: UserRepository,
    private eventBus: EventBus,
  ) {}

  async create(input: CreateUserInput): Promise<Result<User, ConflictError>> {
    const existing = await this.repo.findByEmail(input.email);
    if (existing) {
      return err(new ConflictError('User', 'email', input.email));
    }

    const user = await this.repo.create(nanoid(), input);
    await this.eventBus.publish(createDomainEvent(USER_EVENTS.CREATED, { user }));
    return ok(user);
  }

  async findById(id: string): Promise<Result<User, NotFoundError>> {
    const user = await this.repo.findById(id);
    if (!user) {
      return err(new NotFoundError('User', id));
    }
    return ok(user);
  }

  async findByEmail(email: string): Promise<Result<User, NotFoundError>> {
    const user = await this.repo.findByEmail(email);
    if (!user) {
      return err(new NotFoundError('User', email));
    }
    return ok(user);
  }

  async update(
    id: string,
    input: UpdateUserInput,
  ): Promise<Result<User, NotFoundError | ConflictError>> {
    if (input.email) {
      const existing = await this.repo.findByEmail(input.email);
      if (existing && existing.id !== id) {
        return err(new ConflictError('User', 'email', input.email));
      }
    }

    const user = await this.repo.update(id, input);
    if (!user) {
      return err(new NotFoundError('User', id));
    }

    await this.eventBus.publish(createDomainEvent(USER_EVENTS.UPDATED, { user, changes: input }));
    return ok(user);
  }

  async delete(id: string): Promise<Result<void, NotFoundError>> {
    const deleted = await this.repo.delete(id);
    if (!deleted) {
      return err(new NotFoundError('User', id));
    }
    await this.eventBus.publish(createDomainEvent(USER_EVENTS.DELETED, { userId: id }));
    return ok(undefined);
  }

  async list(pagination: PaginationInput): Promise<Result<PaginatedResult<User>>> {
    const { data, total } = await this.repo.list(pagination.page, pagination.pageSize);
    return ok({
      data,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.ceil(total / pagination.pageSize),
    });
  }

  async updatePassword(id: string, hash: string): Promise<Result<void, NotFoundError>> {
    const user = await this.repo.update(id, { passwordHash: hash });
    if (!user) {
      return err(new NotFoundError('User', id));
    }
    return ok(undefined);
  }

  async verifyEmail(id: string): Promise<Result<void, NotFoundError>> {
    const user = await this.repo.update(id, { emailVerified: true });
    if (!user) {
      return err(new NotFoundError('User', id));
    }
    await this.eventBus.publish(createDomainEvent(USER_EVENTS.EMAIL_VERIFIED, { userId: id }));
    return ok(undefined);
  }

  async suspend(id: string): Promise<Result<void, NotFoundError>> {
    const user = await this.repo.update(id, { status: 'suspended' });
    if (!user) {
      return err(new NotFoundError('User', id));
    }
    await this.eventBus.publish(createDomainEvent(USER_EVENTS.SUSPENDED, { userId: id }));
    return ok(undefined);
  }

  async activate(id: string): Promise<Result<void, NotFoundError>> {
    const user = await this.repo.update(id, { status: 'active' });
    if (!user) {
      return err(new NotFoundError('User', id));
    }
    await this.eventBus.publish(createDomainEvent(USER_EVENTS.ACTIVATED, { userId: id }));
    return ok(undefined);
  }
}
