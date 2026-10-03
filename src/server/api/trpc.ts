import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import superjson from "superjson";
import { getCurrentSession, type SessionUser } from "@/server/auth/session";
import { TWO_FACTOR_ENFORCED } from "@/server/config/policy";
import { db } from "@/server/db";
import { type UserRole, users } from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import { AppError } from "@/server/errors";

/**
 * `headers` are the request headers; a context without them fails the mutation Origin check.
 * `twoFactorVerified` comes from the session; `isSuperAdmin` is read from the user row on demand
 * when absent (tests pass it directly).
 */
export type TrpcContext = {
  user: SessionUser | null;
  headers?: Headers;
  twoFactorVerified?: boolean;
  isSuperAdmin?: boolean;
  /** Hash of the calling session's token, for "this session" decisions; never sent to a client. */
  sessionTokenHash?: string;
  /** The device the calling session is bound to (students), or null. */
  sessionDeviceId?: string | null;
};

export async function createTrpcContext({ req }: { req: Request }): Promise<TrpcContext> {
  const session = await getCurrentSession();
  return {
    user: session?.user ?? null,
    twoFactorVerified: session?.twoFactorVerified ?? false,
    sessionTokenHash: session?.tokenHash,
    sessionDeviceId: session?.deviceId ?? null,
    headers: req.headers,
  };
}

/** Every procedure declares one guard; `guards.test.ts` enumerates them. */
export type GuardKind = "public" | "protected" | "role" | "staff" | "superAdmin";
export type GuardMeta = { guard: GuardKind; twoFactor?: boolean };
/** Roles that sign in to staff tools and therefore need two-factor (A7b). */
export type StaffRole = Extract<UserRole, "teacher" | "admin" | "reviewer">;

const GENERIC_INTERNAL_MESSAGE = "Internal server error";

const t = initTRPC
  .meta<GuardMeta>()
  .context<TrpcContext>()
  .create({
    transformer: superjson,
    errorFormatter({ shape }) {
      if (shape.data.code !== "INTERNAL_SERVER_ERROR") return shape;
      const { stack: _stack, ...data } = shape.data;
      return { ...shape, message: GENERIC_INTERNAL_MESSAGE, data };
    },
  });

/** Maps AppError to its declared tRPC code; the original stays as `cause` for server logs. */
const mapAppErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const cause = result.error.cause;
  if (cause instanceof AppError) {
    throw new TRPCError({
      code: cause.trpcCode,
      message: cause.i18nKey,
      cause,
    });
  }
  return result;
});

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Mutations must come from this site: Origin present and its host equal to the request or BASE_URL host. */
export function isAllowedOrigin(
  headers: Headers | undefined,
  baseUrl: string | undefined,
): boolean {
  const origin = hostOf(headers?.get("origin") ?? undefined);
  if (!origin) return false;
  const requestHost = headers?.get("host")?.toLowerCase();
  return origin === requestHost || origin === hostOf(baseUrl);
}

const requireSameOrigin = t.middleware(async ({ type, ctx, next }) => {
  if (type === "mutation" && !isAllowedOrigin(ctx.headers, serverEnv().BASE_URL)) {
    throw new AppError("forbidden", { message: "origin" });
  }
  return next();
});

/** Postgres error code from a driver error or anything in its cause chain, never a message (it quotes the row). */
function pgCode(error: unknown, depth = 0): string | undefined {
  if (typeof error !== "object" || error === null || depth > 5) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  return pgCode((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Server-side log of the real error. Never sent to the client. An unexpected error logs only its
 * class name and a pg code: a Drizzle error's message and params quote the row (email, hash).
 */
export function logTrpcError({
  path,
  error,
}: {
  path: string | undefined;
  error: TRPCError;
}): void {
  const real = error.cause ?? error;
  if (real instanceof AppError) {
    console[real.logLevel](`[trpc] ${path ?? "?"} ${real.code}`, real);
    return;
  }
  if (error.code === "INTERNAL_SERVER_ERROR") {
    const name = real instanceof Error ? real.name : "unknown";
    const code = pgCode(real);
    console.error(`[trpc] ${path ?? "?"} failed (${name}${code ? `, pg ${code}` : ""})`);
  }
}

let twoFactorEnforced: () => boolean = () => TWO_FACTOR_ENFORCED;
/** Test hook: pass a getter to override `TWO_FACTOR_ENFORCED`, or null to restore it. Throws outside tests. */
export function setTwoFactorEnforcedForTests(getter: (() => boolean) | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error('setTwoFactorEnforcedForTests is only available when NODE_ENV is "test"');
  }
  twoFactorEnforced = getter ?? (() => TWO_FACTOR_ENFORCED);
}

/** Signed-in and active: no user is UNAUTHORIZED, a suspended one is FORBIDDEN. */
const requireActiveUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "errors.unauthenticated" });
  }
  if (ctx.user.status !== "active") throw new AppError("forbidden", { message: "status" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireRoles = (roles: readonly UserRole[]) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new AppError("forbidden", { message: "role" });
    }
    return next();
  });

/** Passes when the session is two-factor verified, or while `TWO_FACTOR_ENFORCED` is false (A7b flips it). */
const requireTwoFactor = t.middleware(async ({ ctx, next }) => {
  if (twoFactorEnforced() && ctx.twoFactorVerified !== true) {
    throw new AppError("forbidden", { message: "two_factor" });
  }
  return next();
});

async function readIsSuperAdmin(ctx: TrpcContext): Promise<boolean> {
  if (ctx.isSuperAdmin !== undefined) return ctx.isSuperAdmin;
  if (!ctx.user) return false;
  const row = await db().query.users.findFirst({
    where: eq(users.id, ctx.user.id),
    columns: { isSuperAdmin: true },
  });
  return row?.isSuperAdmin === true;
}

const requireSuperAdmin = t.middleware(async ({ ctx, next }) => {
  if (!(await readIsSuperAdmin(ctx))) throw new AppError("forbidden", { message: "super_admin" });
  return next();
});

export const router = t.router;
/** No sign-in needed. Must be listed in `PUBLIC_PROCEDURES` with a reason. */
export const publicProcedure = t.procedure
  .meta({ guard: "public" })
  .use(mapAppErrors)
  .use(requireSameOrigin);
/** A signed-in user with status `active`; the handler's `ctx.user` is non-null. */
export const protectedProcedure = publicProcedure
  .meta({ guard: "protected" })
  .use(requireActiveUser);
/** Protected plus a role check. */
export const roleProcedure = (...roles: UserRole[]) =>
  protectedProcedure.meta({ guard: "role" }).use(requireRoles(roles));
/** Teacher, admin or reviewer; runs the two-factor check. */
export const staffProcedure = (...roles: StaffRole[]) =>
  protectedProcedure
    .meta({ guard: "staff", twoFactor: true })
    .use(requireRoles(roles))
    .use(requireTwoFactor);
/** Admin with `is_super_admin`; runs the two-factor check. */
export const superAdminProcedure = protectedProcedure
  .meta({ guard: "superAdmin", twoFactor: true })
  .use(requireRoles(["admin"]))
  .use(requireSuperAdmin)
  .use(requireTwoFactor);
export const createCallerFactory = t.createCallerFactory;
