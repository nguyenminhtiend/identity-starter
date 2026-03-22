import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { roles } from './schema/role.js';
import { users } from './schema/user.js';
import { userRoles } from './schema/user-role.js';

const ADMIN_EMAIL = 'admin@e2e.local';
const ADMIN_PASSWORD = 'Admin123!';

const url = process.env.DATABASE_URL;
if (!url) {
  // biome-ignore lint/suspicious/noConsole: CLI seed script
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

const passwordHash = await hash(ADMIN_PASSWORD, {
  algorithm: 2, // Argon2id
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
  parallelism: 1,
});

const [adminUser] = await db
  .insert(users)
  .values({
    email: ADMIN_EMAIL,
    passwordHash,
    displayName: 'E2E Admin',
    status: 'active',
    emailVerified: true,
    isAdmin: true,
  })
  .onConflictDoNothing()
  .returning({ id: users.id });

if (adminUser) {
  const [superAdminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'super_admin'))
    .limit(1);

  if (superAdminRole) {
    await db
      .insert(userRoles)
      .values({
        userId: adminUser.id,
        roleId: superAdminRole.id,
        assignedBy: adminUser.id,
      })
      .onConflictDoNothing();

    // biome-ignore lint/suspicious/noConsole: CLI seed script
    console.log(`Seeded admin user: ${ADMIN_EMAIL} (super_admin)`);
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI seed script
    console.error('super_admin role not found — did the server start and seed roles?');
    await client.end();
    process.exit(1);
  }
} else {
  // biome-ignore lint/suspicious/noConsole: CLI seed script
  console.log('Admin user already exists, skipping');
}

await client.end();
// biome-ignore lint/suspicious/noConsole: CLI seed script
console.log('E2E seed complete.');
