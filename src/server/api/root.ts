import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";
import { healthRouter } from "./routers/health";
import { parentRouter } from "./routers/parent";
import { studentRouter } from "./routers/student";
import { router } from "./trpc";

export const appRouter = router({
  admin: adminRouter,
  auth: authRouter,
  health: healthRouter,
  parent: parentRouter,
  student: studentRouter,
});

export type AppRouter = typeof appRouter;
