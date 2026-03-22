import { faker } from '@faker-js/faker';
import type { CreateAuditLogInput } from '../audit.schemas.js';

export function makeCreateAuditLogInput(
  overrides?: Partial<CreateAuditLogInput>,
): CreateAuditLogInput {
  return {
    actorId: faker.string.uuid(),
    action: 'auth.login',
    resourceType: 'user',
    resourceId: faker.string.uuid(),
    details: {},
    ipAddress: faker.internet.ipv4(),
    ...overrides,
  };
}
