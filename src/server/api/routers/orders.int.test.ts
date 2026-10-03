import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("@/server/auth/request-context", () => ({
  requestContext: vi.fn(async () => ({ ip: "9.9.9.9", deviceId: null })),
}));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({
    BASE_URL: "https://alnamer.example",
    APP_MODE: "demo",
    providers: { payment: "mock", jobs: "inline" },
  }),
}));
vi.mock("@/server/db", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const dbSchema = await import("@/server/db/schema");
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 4, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { appRouter } = await import("../root");
const { createCallerFactory } = await import("../trpc");
const { createCourse, createUser, linkParent } = await import("@/server/orders/test-fixtures");
const { setMockInvoiceStatus } = await import("@/server/payments/mock");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const HEADERS = new Headers({ origin: "https://alnamer.example", host: "alnamer.example" });
type TestUser = Awaited<ReturnType<typeof createUser>>;
const as = (user: TestUser) => createCallerFactory(appRouter)({ user, headers: HEADERS });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

describe("orders router", () => {
  it("start, get and recheck for a parent buying for a child", async () => {
    const parent = await createUser(conn, { role: "parent" });
    const child = await createUser(conn, { email: false });
    await linkParent(conn, parent.id, child.id);
    const course = await createCourse(conn);

    const started = await as(parent).orders.start({
      courseId: course.courseId,
      beneficiaryStudentId: child.id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const view = await as(parent).orders.get({ number: started.orderNumber });
    expect(view).toMatchObject({
      number: started.orderNumber,
      status: "pending",
      forChild: true,
      amountMinor: 5000,
      currency: "AED",
    });
    // The beneficiary sees it too.
    expect((await as(child).orders.get({ number: started.orderNumber })).status).toBe("pending");

    const invoiceId = started.paymentUrl.split("/").pop() ?? "";
    await setMockInvoiceStatus(invoiceId, "paid");
    const rechecked = await as(parent).orders.recheck({ number: started.orderNumber });
    expect(rechecked.status).toBe("paid");
  });

  it("get answers not found (not forbidden) for a stranger, and for unknown numbers", async () => {
    const student = await createUser(conn);
    const stranger = await createUser(conn);
    const course = await createCourse(conn);
    const started = await as(student).orders.start({ courseId: course.courseId });
    if (!started.ok) throw new Error("start failed");
    await expect(as(stranger).orders.get({ number: started.orderNumber })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      as(stranger).orders.recheck({ number: started.orderNumber }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(as(student).orders.get({ number: "ZZZZZZZZ" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("start refusals come back as reasons, a forbidden role as FORBIDDEN-free reason", async () => {
    const teacher = await createUser(conn, { role: "teacher" });
    const course = await createCourse(conn);
    expect(await as(teacher).orders.start({ courseId: course.courseId })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
