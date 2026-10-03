import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setClockForTests } from "@/server/clock";
import * as schema from "@/server/db/schema";
import { MemoryLimiter } from "../../../test/fake-limiter";

vi.mock("@/server/redis", () => ({ getRedis: () => null }));
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
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 6, onnotice: () => {} });
  const conn = drizzle(client, { schema: dbSchema });
  return { db: () => conn, closeTestDb: () => client.end() };
});

const dbModule = (await import("@/server/db")) as unknown as {
  db: () => import("@/server/orders/test-fixtures").TestConn;
  closeTestDb: () => Promise<void>;
};
const conn = dbModule.db();
const { startCheckout } = await import("./checkout");
const { confirmPayment } = await import("./confirm");
const { createMockGateway, setMockInvoiceStatus } = await import("@/server/payments/mock");
const { createCourse, createEntitlement, createUser } = await import("./test-fixtures");

const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;
const gateway = createMockGateway();
const deps = () => ({ gateway, limiter: new MemoryLimiter(), key: Buffer.alloc(32, 7) });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function buy(options: Parameters<typeof createCourse>[1] = {}) {
  const student = await createUser(conn);
  const course = await createCourse(conn, options);
  const started = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);
  const [order] = await conn
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, started.orderId));
  if (!order?.gatewayInvoiceId) throw new Error("order has no invoice");
  return { student, course, orderId: order.id, invoiceId: order.gatewayInvoiceId };
}

const orderOf = (id: string) =>
  conn
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .then((rows) => rows[0]);
const grantsOf = (studentId: string) =>
  conn.select().from(schema.entitlements).where(eq(schema.entitlements.studentId, studentId));

describe("confirmPayment", () => {
  it("paid once: order paid, one entitlement for the access window", async () => {
    const { student, course, orderId, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "paid");
    const result = await confirmPayment(invoiceId, { gateway });
    expect(result).toMatchObject({ kind: "order", orderId, status: "paid", refundFlag: null });
    const order = await orderOf(orderId);
    expect(order).toMatchObject({ status: "paid", gatewayInvoiceId: invoiceId, refundFlag: null });
    expect(order?.paidAt?.getTime()).toBe(NOW.getTime());
    expect(order?.gatewayPaymentId).toMatch(/^MOCKPAY-/);
    expect(typeof order?.gatewayFeeMinor).toBe("number");
    const grants = await grantsOf(student.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      courseId: course.courseId,
      source: "order",
      orderId,
      revokedAt: null,
    });
    expect(grants[0]?.startsAt.getTime()).toBe(NOW.getTime());
    expect(grants[0]?.endsAt.getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });

  it("replaying the return three times gives one paid order and one entitlement", async () => {
    const { student, orderId, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "paid");
    for (let i = 0; i < 3; i++) {
      setClockForTests(new Date(NOW.getTime() + i * 60_000));
      await confirmPayment(invoiceId, { gateway });
    }
    expect((await orderOf(orderId))?.status).toBe("paid");
    expect((await orderOf(orderId))?.paidAt?.getTime()).toBe(NOW.getTime());
    expect(await grantsOf(student.id)).toHaveLength(1);
  });

  it("concurrent confirmations also give one entitlement", async () => {
    const { student, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "paid");
    await Promise.all([
      confirmPayment(invoiceId, { gateway }),
      confirmPayment(invoiceId, { gateway }),
      confirmPayment(invoiceId, { gateway }),
    ]);
    expect(await grantsOf(student.id)).toHaveLength(1);
  });

  it("applies a paid invoice after the order expired", async () => {
    const { student, orderId, invoiceId } = await buy();
    await conn
      .update(schema.orders)
      .set({ status: "expired" })
      .where(eq(schema.orders.id, orderId));
    await setMockInvoiceStatus(invoiceId, "paid");
    await confirmPayment(invoiceId, { gateway });
    expect((await orderOf(orderId))?.status).toBe("paid");
    expect(await grantsOf(student.id)).toHaveLength(1);
  });

  it("applies a paid invoice after the order was cancelled", async () => {
    const { student, orderId, invoiceId } = await buy();
    await conn
      .update(schema.orders)
      .set({ status: "cancelled" })
      .where(eq(schema.orders.id, orderId));
    await setMockInvoiceStatus(invoiceId, "paid");
    await confirmPayment(invoiceId, { gateway });
    expect((await orderOf(orderId))?.status).toBe("paid");
    expect(await grantsOf(student.id)).toHaveLength(1);
  });

  it("paid while the beneficiary has overlapping access: paid_duplicate, no new entitlement", async () => {
    const { student, course, orderId, invoiceId } = await buy();
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW.getTime() + 5 * DAY_MS),
    });
    await setMockInvoiceStatus(invoiceId, "paid");
    const result = await confirmPayment(invoiceId, { gateway });
    expect(result).toMatchObject({ status: "paid_duplicate", refundFlag: "duplicate" });
    const order = await orderOf(orderId);
    expect(order).toMatchObject({ status: "paid_duplicate", refundFlag: "duplicate" });
    expect(order?.paidAt).not.toBeNull();
    expect(await grantsOf(student.id)).toHaveLength(1);
  });

  it("paid after a fixed-end course ended: paid, refund flag, no entitlement", async () => {
    const endAt = new Date(NOW.getTime() + 10 * DAY_MS);
    const { student, orderId, invoiceId } = await buy({ access: { kind: "fixed_end", endAt } });
    setClockForTests(new Date(endAt.getTime() + DAY_MS));
    await setMockInvoiceStatus(invoiceId, "paid");
    const result = await confirmPayment(invoiceId, { gateway });
    expect(result).toMatchObject({ status: "paid", refundFlag: "paid_after_access_end" });
    expect((await orderOf(orderId))?.refundFlag).toBe("paid_after_access_end");
    expect(await grantsOf(student.id)).toHaveLength(0);
  });

  it("a fixed-end course grants access until its end date", async () => {
    const endAt = new Date(NOW.getTime() + 10 * DAY_MS);
    const { student, invoiceId } = await buy({ access: { kind: "fixed_end", endAt } });
    await setMockInvoiceStatus(invoiceId, "paid");
    await confirmPayment(invoiceId, { gateway });
    const [grant] = await grantsOf(student.id);
    expect(grant?.endsAt.getTime()).toBe(endAt.getTime());
  });

  it("amount mismatch grants nothing", async () => {
    const { student, orderId, invoiceId } = await buy();
    await conn
      .update(schema.orders)
      .set({ listPriceMinor: 9999, amountMinor: 9999 })
      .where(eq(schema.orders.id, orderId));
    await setMockInvoiceStatus(invoiceId, "paid");
    const result = await confirmPayment(invoiceId, { gateway });
    expect(result).toMatchObject({ kind: "mismatch", orderId });
    expect((await orderOf(orderId))?.status).toBe("pending");
    expect(await grantsOf(student.id)).toHaveLength(0);
  });

  it("gateway failed: a pending order becomes failed", async () => {
    const { student, orderId, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "failed");
    await confirmPayment(invoiceId, { gateway });
    expect((await orderOf(orderId))?.status).toBe("failed");
    expect(await grantsOf(student.id)).toHaveLength(0);
  });

  it("gateway expired: a pending order becomes expired", async () => {
    const { orderId, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "expired");
    await confirmPayment(invoiceId, { gateway });
    expect((await orderOf(orderId))?.status).toBe("expired");
  });

  it("gateway pending: nothing changes", async () => {
    const { student, orderId, invoiceId } = await buy();
    const result = await confirmPayment(invoiceId, { gateway });
    expect(result).toMatchObject({ kind: "order", status: "pending" });
    expect((await orderOf(orderId))?.status).toBe("pending");
    expect(await grantsOf(student.id)).toHaveLength(0);
  });

  it("a later failed report does not undo a paid order", async () => {
    const { orderId, invoiceId } = await buy();
    await setMockInvoiceStatus(invoiceId, "paid");
    await confirmPayment(invoiceId, { gateway });
    await setMockInvoiceStatus(invoiceId, "failed");
    await confirmPayment(invoiceId, { gateway });
    expect((await orderOf(orderId))?.status).toBe("paid");
  });

  it("an unknown invoice is not_found", async () => {
    expect(await confirmPayment("MOCK-does-not-exist", { gateway })).toEqual({
      kind: "not_found",
    });
  });
});
