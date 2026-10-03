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
const { createMockGateway } = await import("@/server/payments/mock");
const { createCourse, createDevice, createEntitlement, createUser, linkParent } = await import(
  "./test-fixtures"
);

const NOW = new Date("2030-05-01T09:00:00.000Z");
const DAY_MS = 86_400_000;
const KEY = Buffer.alloc(32, 7);
const gateway = createMockGateway();

const deps = () => ({ gateway, limiter: new MemoryLimiter(), key: KEY });

beforeEach(() => setClockForTests(NOW));
afterAll(async () => {
  setClockForTests(null);
  await dbModule.closeTestDb();
});

async function ordersOf(studentId: string, courseId: string) {
  return conn
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.beneficiaryStudentId, studentId))
    .then((rows) => rows.filter((row) => row.courseId === courseId));
}

describe("startCheckout", () => {
  it("student buys for self: pending order with snapshots, invoice and payment url", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn, { priceMinor: 12_345 });
    const result = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.orderNumber).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(result.paymentUrl).toMatch(/^\/dev\/pay\/MOCK-/);
    const [order] = await ordersOf(student.id, course.courseId);
    expect(order).toMatchObject({
      buyerId: student.id,
      beneficiaryStudentId: student.id,
      courseRevisionId: course.revisionId,
      status: "pending",
      listPriceMinor: 12_345,
      discountMinor: 0,
      amountMinor: 12_345,
      currency: "AED",
      teacherRateBp: 7000,
      channel: "online",
      collectedBy: "platform",
    });
    expect(order?.gatewayInvoiceId).toMatch(/^MOCK-/);
    expect(order?.expiresAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
  });

  it("reuses the current pending order", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const first = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    const second = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.orderId).toBe(first.orderId);
    expect(await ordersOf(student.id, course.courseId)).toHaveLength(1);
  });

  it("marks an expired pending order expired and opens a new one", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const first = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    if (!first.ok) throw new Error("first start failed");
    setClockForTests(new Date(NOW.getTime() + 25 * 60 * 60 * 1000));
    const second = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.orderId).not.toBe(first.orderId);
    const rows = await ordersOf(student.id, course.courseId);
    expect(rows.find((row) => row.id === first.orderId)?.status).toBe("expired");
    expect(rows.find((row) => row.id === second.orderId)?.status).toBe("pending");
  });

  it("retries a failed order on the same row with a new invoice and expiry", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const first = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    if (!first.ok) throw new Error("first start failed");
    const [before] = await ordersOf(student.id, course.courseId);
    await conn
      .update(schema.orders)
      .set({ status: "failed" })
      .where(eq(schema.orders.id, first.orderId));
    setClockForTests(new Date(NOW.getTime() + 60 * 60 * 1000));
    const retry = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.orderId).toBe(first.orderId);
    const rows = await ordersOf(student.id, course.courseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.gatewayInvoiceId).not.toBe(before?.gatewayInvoiceId);
    expect(rows[0]?.expiresAt.getTime()).toBe(NOW.getTime() + 25 * 60 * 60 * 1000);
  });

  it("refuses when the beneficiary already has active access", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const endsAt = new Date(NOW.getTime() + 10 * DAY_MS);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt,
    });
    const result = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(result).toEqual({ ok: false, reason: "already_has_access", endsAt });
    expect(await ordersOf(student.id, course.courseId)).toHaveLength(0);
  });

  it("does not refuse when the earlier access has ended or was revoked", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - 20 * DAY_MS),
      endsAt: new Date(NOW.getTime() - DAY_MS),
    });
    await createEntitlement(conn, {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW.getTime() + 20 * DAY_MS),
      revokedAt: NOW,
    });
    const result = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(result.ok).toBe(true);
  });

  it("two simultaneous starts end with one pending order", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const [a, b] = await Promise.all([
      startCheckout({ buyer: student, courseId: course.courseId }, deps()),
      startCheckout({ buyer: student, courseId: course.courseId }, deps()),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.orderId).toBe(b.orderId);
    expect(await ordersOf(student.id, course.courseId)).toHaveLength(1);
  });

  it("a parent buys for a linked child; the order keeps both ids", async () => {
    const parent = await createUser(conn, { role: "parent" });
    const child = await createUser(conn, { email: false });
    await linkParent(conn, parent.id, child.id);
    const course = await createCourse(conn);
    const result = await startCheckout(
      { buyer: parent, courseId: course.courseId, beneficiaryStudentId: child.id },
      deps(),
    );
    expect(result.ok).toBe(true);
    const [order] = await ordersOf(child.id, course.courseId);
    expect(order).toMatchObject({ buyerId: parent.id, beneficiaryStudentId: child.id });
  });

  it("a parent cannot buy for an unlinked student (IDOR)", async () => {
    const parent = await createUser(conn, { role: "parent" });
    const stranger = await createUser(conn);
    const course = await createCourse(conn);
    const result = await startCheckout(
      { buyer: parent, courseId: course.courseId, beneficiaryStudentId: stranger.id },
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "not_linked" });
    expect(await ordersOf(stranger.id, course.courseId)).toHaveLength(0);
  });

  it("refuses by role and email state", async () => {
    const course = await createCourse(conn);
    const noEmail = await createUser(conn, { email: false });
    const unverified = await createUser(conn, { verified: false });
    const teacher = await createUser(conn, { role: "teacher" });
    const other = await createUser(conn);
    const unverifiedParent = await createUser(conn, { role: "parent", verified: false });
    const child = await createUser(conn, { email: false });
    await linkParent(conn, unverifiedParent.id, child.id);
    const start = (buyer: typeof noEmail, beneficiaryStudentId?: string) =>
      startCheckout({ buyer, courseId: course.courseId, beneficiaryStudentId }, deps());
    expect(await start(noEmail)).toEqual({ ok: false, reason: "ask_parent" });
    expect(await start(unverified)).toEqual({ ok: false, reason: "verify_email" });
    expect(await start(teacher)).toEqual({ ok: false, reason: "forbidden" });
    expect(await start(other, noEmail.id)).toEqual({ ok: false, reason: "forbidden" });
    expect(await start(unverifiedParent, child.id)).toEqual({
      ok: false,
      reason: "verify_email",
    });
  });

  it("course checks: free, access ended, draft, sample", async () => {
    const student = await createUser(conn);
    const free = await createCourse(conn, { priceMinor: 0 });
    expect(await startCheckout({ buyer: student, courseId: free.courseId }, deps())).toEqual({
      ok: false,
      reason: "not_for_sale",
    });

    const endingSoon = await createCourse(conn, {
      access: { kind: "fixed_end", endAt: new Date(NOW.getTime() + 60 * 60 * 1000) },
    });
    expect(await startCheckout({ buyer: student, courseId: endingSoon.courseId }, deps())).toEqual({
      ok: false,
      reason: "access_ended",
    });

    const draft = await createCourse(conn, { status: "draft" });
    expect(await startCheckout({ buyer: student, courseId: draft.courseId }, deps())).toEqual({
      ok: false,
      reason: "not_found",
    });

    const sample = await createCourse(conn, { isSample: true });
    expect(
      await startCheckout(
        { buyer: student, courseId: sample.courseId },
        { ...deps(), appMode: "live" },
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await startCheckout({ buyer: student, courseId: sample.courseId }, deps())).ok).toBe(
      true,
    );

    await conn.update(schema.platformSettings).set({ sampleHiddenAt: NOW });
    try {
      const other = await createUser(conn);
      expect(await startCheckout({ buyer: other, courseId: sample.courseId }, deps())).toEqual({
        ok: false,
        reason: "not_found",
      });
    } finally {
      await conn.update(schema.platformSettings).set({ sampleHiddenAt: null });
    }
  });

  it("keeps a pending order without an invoice when the gateway fails, then recovers", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const broken = {
      createInvoice: async () => {
        throw new Error("gateway down");
      },
      getPaymentStatus: gateway.getPaymentStatus,
    };
    const failed = await startCheckout(
      { buyer: student, courseId: course.courseId },
      { ...deps(), gateway: broken },
    );
    expect(failed).toMatchObject({ ok: false, reason: "try_again" });
    const [pending] = await ordersOf(student.id, course.courseId);
    expect(pending?.status).toBe("pending");
    expect(pending?.gatewayInvoiceId).toBeNull();

    const again = await startCheckout({ buyer: student, courseId: course.courseId }, deps());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.orderId).toBe(pending?.id);
  });

  it("limits starts to 10 per 10 minutes per user", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    const shared = deps();
    for (let i = 0; i < 10; i++) {
      expect((await startCheckout({ buyer: student, courseId: course.courseId }, shared)).ok).toBe(
        true,
      );
    }
    expect(await startCheckout({ buyer: student, courseId: course.courseId }, shared)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect([...shared.limiter.keys].some((key) => key.startsWith("rl:checkout:"))).toBe(true);
  });

  it("a revoked-device student can still start checkout (devices gate playback only)", async () => {
    const student = await createUser(conn);
    await createDevice(conn, student.id, { revoked: true });
    const course = await createCourse(conn);
    expect((await startCheckout({ buyer: student, courseId: course.courseId }, deps())).ok).toBe(
      true,
    );
  });
});
