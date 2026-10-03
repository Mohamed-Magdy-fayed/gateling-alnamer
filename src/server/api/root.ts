import { accountRouter } from "./routers/account";
import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";
import { healthRouter } from "./routers/health";
import { ordersRouter } from "./routers/orders";
import { parentRouter } from "./routers/parent";
import { studentRouter } from "./routers/student";
import { videoRouter } from "./routers/video";
import { router } from "./trpc";

export const appRouter = router({
  account: accountRouter,
  admin: adminRouter,
  auth: authRouter,
  health: healthRouter,
  orders: ordersRouter,
  parent: parentRouter,
  student: studentRouter,
  video: videoRouter,
});

export type AppRouter = typeof appRouter;
