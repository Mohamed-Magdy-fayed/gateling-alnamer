import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { AppError } from "@/server/errors";

export type TrpcContext = { user: SessionUser | null };

export async function createTrpcContext(): Promise<TrpcContext> {
  return { user: await getCurrentUser() };
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
    throw new TRPCError({ code: cause.trpcCode, message: cause.i18nKey, cause });
  }
  return result;
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

export const router = t.router;
export const publicProcedure = t.procedure.use(mapAppErrors);
export const createCallerFactory = t.createCallerFactory;
