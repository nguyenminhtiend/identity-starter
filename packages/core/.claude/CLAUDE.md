# Core Package

Zero-dependency TypeScript utilities shared across the monorepo: Result monad, domain errors, branded types, pagination.

## Files

| File | Purpose |
|---|---|
| `result.ts` | `Result<T, E>` monad — `ok(v)`, `err(e)`, `isOk()`, `isErr()`, `unwrap()` (throws on err) |
| `errors.ts` | `DomainError` hierarchy — `NotFoundError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError` |
| `types.ts` | `Brand<T, B>` nominal types (e.g., `UserId`), `PaginatedResult` with computed `totalPages` |
| `index.ts` | Barrel export |

## Error Codes

Uppercase string constants: `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`

`ValidationError` includes field-level errors: `{ fields: Record<string, string> }`

## Usage

```typescript
import { ok, err, unwrap } from '@identity-starter/core';
import { NotFoundError } from '@identity-starter/core';
import type { UserId } from '@identity-starter/core';
```
