# Recipe: add a tRPC procedure

Example in this codebase: `health.ping` (`src/server/api/routers/health.ts`).

## Files to touch
- `src/server/api/routers/<name>.ts`: the router (one file per domain).
- `src/server/api/root.ts`: register it on `appRouter`.
- `src/server/api/<name>.test.ts`: the test.

## Test first
Call the router through a caller, no HTTP. Mock the session module so no database or cookies are needed (copy `src/server/api/health.test.ts`):

```ts
vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));

const caller = createCallerFactory(appRouter)({ user: null });
const result = await caller.health.ping();
expect(result.ok).toBe(true);
```

Run it, watch it fail, then write the procedure.

## The procedure

```ts
// src/server/api/routers/health.ts
import { publicProcedure, router } from "../trpc";

export const healthRouter = router({
  ping: publicProcedure.query(() => ({ ok: true as const, at: new Date() })),
});
```

```ts
// src/server/api/root.ts
export const appRouter = router({ health: healthRouter });
```

## Rules
- Validate input with a Zod schema: `.input(z.object({ ... }))`. No `any`.
- Use `.query` for reads and `.mutation` for writes.
- Types flow from `AppRouter`; never hand-write response types.
- Run `npm run verify` before pushing.

## Guards (required)
Every procedure is built from a guarded base in `src/server/api/trpc.ts`; `src/server/api/guards.test.ts` fails and names the procedure otherwise.

| Base | Use for |
|---|---|
| `protectedProcedure` | any signed-in, active user |
| `roleProcedure("parent")` | student, parent (and any non-staff role) |
| `staffProcedure("admin")` | teacher / admin / reviewer; runs the two-factor check. Every `admin.*` procedure uses this |
| `superAdminProcedure` | admin with `is_super_admin`; runs the two-factor check |
| `publicProcedure` | no sign-in; add the path with a one-line reason to `src/server/api/public-procedures.ts` |
