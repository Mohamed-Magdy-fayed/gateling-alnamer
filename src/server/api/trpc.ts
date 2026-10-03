import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import type { UserRole } from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import { AppError } from "@/server/errors";

/** `headers` are the request headers; a context without them fails the mutation Origin check. */
export type TrpcContext = { user: SessionUser | null; headers?: Headers };

export async function createTrpcContext({ req }: { req: Request }): Promise<TrpcContext> {
  return { user: await getCurrentUser(), headers: req.headers };
}

const GENERIC_INTERNAL_MESSAGE = "Internal server error";

const t = initTRPC.context<TrpcContext>().create({
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

/** Server-side log of the real error. Never sent to the client. */
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
    console.error(`[trpc] ${path ?? "?"} failed`, real);
  }
}

/**
 * Role gate: no user is UNAUTHORIZED, a user of another role is FORBIDDEN. Use as
 * `publicProcedure.use(requireRole("parent"))`; the handler's `ctx.user` is then non-null.
 */
export const requireRole = (...roles: UserRole[]) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "errors.unauthenticated",
      });
    if (!roles.includes(ctx.user.role)) throw new AppError("forbidden", { message: "role" });
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

export const router = t.router;
export const publicProcedure = t.procedure.use(mapAppErrors).use(requireSameOrigin);
export const createCallerFactory = t.createCallerFactory;
