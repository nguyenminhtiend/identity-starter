import type { Database } from '@identity-starter/db';
import { users } from '@identity-starter/db';
import { asc, count, eq } from 'drizzle-orm';
import type { CreateUserInput, UpdateUserInput, User } from './user.types.js';

export class UserRepository {
  constructor(private db: Database) {}

  async create(id: string, input: CreateUserInput): Promise<User> {
    const [user] = await this.db
      .insert(users)
      .values({
        id,
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    return this.mapToUser(user);
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ? this.mapToUser(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ? this.mapToUser(user) : null;
  }

  async update(
    id: string,
    input: UpdateUserInput & {
      emailVerified?: boolean;
      status?: User['status'];
      passwordHash?: string;
    },
  ): Promise<User | null> {
    const [user] = await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user ? this.mapToUser(user) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return result.length > 0;
  }

  async list(page: number, pageSize: number): Promise<{ data: User[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(users).orderBy(asc(users.createdAt)).offset(offset).limit(pageSize),
      this.db.select({ total: count() }).from(users),
    ]);
    return {
      data: rows.map((r) => this.mapToUser(r)),
      total,
    };
  }

  private mapToUser(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      status: row.status as User['status'],
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
