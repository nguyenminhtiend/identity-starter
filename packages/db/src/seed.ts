import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { permissions } from './schema/permission.js';
import { roles } from './schema/role.js';
import { rolePermissions } from './schema/role-permission.js';
import { users } from './schema/user.js';
import { userRoles } from './schema/user-role.js';

// ---------------------------------------------------------------------------
// Data definitions
// ---------------------------------------------------------------------------

const SYSTEM_ROLES = ['super_admin', 'admin', 'user'] as const;

const DEFAULT_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'roles', action: 'read' },
  { resource: 'roles', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
  { resource: 'audit', action: 'export' },
] as const;

const ADMIN_ROLE_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
] as const;

const ADMIN_EMAIL = 'admin@idp.local';
const ADMIN_PASSWORD = 'Admin123!';

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL;
if (!url) {
  // biome-ignore lint/suspicious/noConsole: CLI seed script
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: CLI seed script
const log = console.log;

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
const start = performance.now();

log('Seeding system roles…');
for (const name of SYSTEM_ROLES) {
  await db
    .insert(roles)
    .values({ name, description: `System ${name} role`, isSystem: true })
    .onConflictDoNothing();
}

log('Seeding permissions…');
for (const perm of DEFAULT_PERMISSIONS) {
  await db.insert(permissions).values(perm).onConflictDoNothing();
}

// Assign permissions to admin role
const [adminRole] = await db
  .select({ id: roles.id })
  .from(roles)
  .where(eq(roles.name, 'admin'))
  .limit(1);

if (adminRole) {
  for (const perm of ADMIN_ROLE_PERMISSIONS) {
    const [permRow] = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.resource, perm.resource), eq(permissions.action, perm.action)))
      .limit(1);

    if (permRow) {
      await db
        .insert(rolePermissions)
        .values({ roleId: adminRole.id, permissionId: permRow.id })
        .onConflictDoNothing();
    }
  }
}

log('Seeding admin user…');
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
    displayName: 'Admin',
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
  }

  // Also assign admin role
  if (adminRole) {
    await db
      .insert(userRoles)
      .values({
        userId: adminUser.id,
        roleId: adminRole.id,
        assignedBy: adminUser.id,
      })
      .onConflictDoNothing();
  }

  log(`  Created: ${ADMIN_EMAIL} (super_admin + admin)`);
} else {
  log(`  Already exists: ${ADMIN_EMAIL}, skipping`);
}

await client.end();
const elapsed = (performance.now() - start).toFixed(0);
log(`Seed complete (${elapsed}ms).`);
