import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";
import { healthRouter } from "./routers/health";
import { router } from "./trpc";

export const appRouter = router({ admin: adminRouter, auth: authRouter, health: healthRouter });

export type AppRouter = typeof appRouter;
