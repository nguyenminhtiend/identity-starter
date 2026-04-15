# Core Package

Zero-dependency TypeScript utilities shared across the monorepo: domain errors, branded types, pagination.

## Files

| File | Purpose |
|---|---|
| `errors.ts` | `DomainError` hierarchy — `NotFoundError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `TooManyRequestsError` |
| `types.ts` | `Brand<T, B>` nominal types (e.g., `UserId`), `PaginatedResult` with computed `totalPages` |
| `index.ts` | Barrel export |

## Error Codes

Uppercase string constants: `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`

`ValidationError` includes field-level errors: `{ fields: Record<string, string> }`

## Usage

```typescript
import { NotFoundError, ConflictError } from '@identity-starter/core';
import type { UserId } from '@identity-starter/core';
```
