import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTrpcContext, logTrpcError } from "@/server/api/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTrpcContext,
    onError: ({ path, error }) => logTrpcError({ path, error }),
  });

export { handler as GET, handler as POST };
