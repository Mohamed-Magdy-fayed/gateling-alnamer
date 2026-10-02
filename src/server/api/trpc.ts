import "server-only";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";

export type TrpcContext = { user: SessionUser | null };

export async function createTrpcContext(): Promise<TrpcContext> {
  return { user: await getCurrentUser() };
}

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
