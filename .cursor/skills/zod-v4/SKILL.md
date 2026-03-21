---
name: zod-v4
description: >-
  Zod 4 syntax rules for this project (zod ^4.x). Use when writing or editing
  Zod schemas, validation logic, or error handling involving Zod. Prevents
  generation of deprecated Zod 3 patterns.
---

# Zod 4 — Correct Syntax

This project uses **Zod 4** (`zod@^4`). Many Zod 3 APIs are deprecated or removed.
Always use the Zod 4 equivalents below.

## String Format Validators

Top-level functions replace chained methods on `z.string()`.

```ts
// ❌ Deprecated
z.string().email()
z.string().uuid()
z.string().url()
z.string().emoji()
z.string().base64()
z.string().nanoid()
z.string().cuid()
z.string().cuid2()
z.string().ulid()

// ✅ Zod 4
z.email()
z.uuid()
z.url()
z.emoji()
z.base64()
z.nanoid()
z.cuid()
z.cuid2()
z.ulid()
z.ipv4()          // replaces z.string().ip() for v4
z.ipv6()          // replaces z.string().ip() for v6
z.cidrv4()        // replaces z.string().cidr()
z.cidrv6()
z.iso.date()
z.iso.time()
z.iso.datetime()
z.iso.duration()
z.guid()          // permissive UUID-like (8-4-4-4-12 hex)
```

These are subclasses of `ZodString`, so `.min()`, `.max()`, `.optional()`, `.nullable()`, etc. still chain:

```ts
z.email().optional()        // ✅
z.uuid().nullable()         // ✅
z.url().min(10).max(2048)   // ✅
```

**Note:** `.min()` / `.max()` on `z.string()` are NOT deprecated — only the format methods are.

## IP and CIDR

```ts
// ❌ Removed
z.string().ip()
z.string().cidr()

// ✅ Zod 4
z.ipv4()
z.ipv6()
z.union([z.ipv4(), z.ipv6()])   // accept both
z.cidrv4()
z.cidrv6()
```

## Error Handling

```ts
// ❌ Deprecated
error.flatten()
error.flatten().fieldErrors
error.format()

// ✅ Zod 4
z.flattenError(error)                // { formErrors: string[], fieldErrors: Record<string, string[]> }
z.flattenError(error).fieldErrors
z.treeifyError(error)                // nested tree structure
z.prettifyError(error)               // human-readable string
```

## Error Customization

```ts
// ❌ Deprecated
z.string().min(5, { message: 'Too short' })
z.string({ invalid_type_error: '...', required_error: '...' })

// ✅ Zod 4
z.string().min(5, { error: 'Too short' })
z.string({
  error: (issue) => issue.input === undefined ? 'Required' : 'Not a string',
})
```

## Object Schemas

```ts
// ❌ Deprecated
z.object({ ... }).strict()
z.object({ ... }).passthrough()
z.object({ ... }).strip()
schema.merge(otherSchema)

// ✅ Zod 4
z.strictObject({ ... })
z.looseObject({ ... })
// .strip() was default behavior, just use z.object()
schema.extend(otherSchema.shape)
// or spread for best tsc perf:
z.object({ ...base.shape, ...extra.shape })
```

## Records

```ts
// ❌ Removed — single-arg z.record()
z.record(z.string())

// ✅ Zod 4 — always two args
z.record(z.string(), z.string())
```

## Enums

```ts
// ❌ Deprecated
z.nativeEnum(MyEnum)

// ✅ Zod 4 — z.enum() accepts TS enums directly
z.enum(MyEnum)
```

## Functions

```ts
// ❌ Zod 3
z.function().args(z.string()).returns(z.number())

// ✅ Zod 4
z.function({ input: [z.string()], output: z.number() })
```

## Defaults

```ts
// Zod 4: .default() value must match OUTPUT type (short-circuits parsing)
z.string().transform((v) => v.length).default(0)   // default is number (output)

// To default the INPUT and still parse, use .prefault()
z.string().transform((v) => v.length).prefault('fallback')  // => 8
```

## UUID Strictness

`z.uuid()` now validates RFC 9562/4122 (variant bits must be `10`).
For a permissive 8-4-4-4-12 hex pattern, use `z.guid()`.

## Types

```ts
// ❌ Removed
z.ZodTypeAny

// ✅ Zod 4
z.ZodType   // replaces ZodTypeAny (Input defaults to unknown now)
```
