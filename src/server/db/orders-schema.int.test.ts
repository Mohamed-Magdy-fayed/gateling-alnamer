import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  createCourse,
  createUser,
  type TestConn,
  type TestCourse,
  type TestUser,
} from "@/server/orders/test-fixtures";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
const conn = drizzle(client, { schema }) as TestConn;
afterAll(() => client.end());

const NOW = new Date("2030-05-01T09:00:00.000Z");

function pgCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return pgCodeOf((error as { cause?: unknown }).cause);
}

async function expectPgError(run: Promise<unknown>, code: string): Promise<void> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the statement to fail").not.toBeNull();
  expect(pgCodeOf(error)).toBe(code);
}

type OrderInsert = typeof schema.orders.$inferInsert;
function orderValues(student: TestUser, course: TestCourse, over: Partial<OrderInsert> = {}) {
  return {
    id: randomUUID(),
    number: randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(),
    buyerId: student.id,
    beneficiaryStudentId: student.id,
    courseId: course.courseId,
    courseRevisionId: course.revisionId,
    listPriceMinor: 5000,
    discountMinor: 0,
    amountMinor: 5000,
    currency: "AED",
    teacherRateBp: 7000,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    ...over,
  } satisfies OrderInsert;
}

describe("orders schema shape", () => {
  it("allows one pending order per beneficiary and course, but not two", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await conn.insert(schema.orders).values(orderValues(student, course));
    await expectPgError(conn.insert(schema.orders).values(orderValues(student, course)), "23505");
    // A non-pending order for the same pair is fine.
    await conn.insert(schema.orders).values(orderValues(student, course, { status: "failed" }));
  });

  it("refuses amount != list - discount and negative amounts", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await expectPgError(
      conn.insert(schema.orders).values(orderValues(student, course, { amountMinor: 4000 })),
      "23514",
    );
    await expectPgError(
      conn
        .insert(schema.orders)
        .values(orderValues(student, course, { listPriceMinor: -1, amountMinor: -1 })),
      "23514",
    );
  });

  it("ties paid_at to the paid statuses", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await expectPgError(
      conn.insert(schema.orders).values(orderValues(student, course, { status: "paid" })),
      "23514",
    );
    await expectPgError(
      conn.insert(schema.orders).values(orderValues(student, course, { paidAt: NOW })),
      "23514",
    );
    await conn
      .insert(schema.orders)
      .values(orderValues(student, course, { status: "paid_duplicate", paidAt: NOW }));
  });

  it("checks currency format, teacher rate range and invoice uniqueness", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await expectPgError(
      conn.insert(schema.orders).values(orderValues(student, course, { currency: "aed" })),
      "23514",
    );
    await expectPgError(
      conn.insert(schema.orders).values(orderValues(student, course, { teacherRateBp: 10001 })),
      "23514",
    );
    const invoice = `INV-${randomUUID()}`;
    await conn
      .insert(schema.orders)
      .values(orderValues(student, course, { status: "failed", gatewayInvoiceId: invoice }));
    await expectPgError(
      conn
        .insert(schema.orders)
        .values(orderValues(student, course, { status: "expired", gatewayInvoiceId: invoice })),
      "23505",
    );
  });
});

describe("entitlements schema shape", () => {
  it("requires ends_at > starts_at, an order for source=order, and one grant per order", async () => {
    const student = await createUser(conn);
    const course = await createCourse(conn);
    await expectPgError(
      conn.insert(schema.entitlements).values({
        id: randomUUID(),
        studentId: student.id,
        courseId: course.courseId,
        startsAt: NOW,
        endsAt: NOW,
        source: "admin_grant",
      }),
      "23514",
    );
    await expectPgError(
      conn.insert(schema.entitlements).values({
        id: randomUUID(),
        studentId: student.id,
        courseId: course.courseId,
        startsAt: NOW,
        endsAt: new Date(NOW.getTime() + 1000),
        source: "order",
      }),
      "23514",
    );
    const order = orderValues(student, course, { status: "paid", paidAt: NOW });
    await conn.insert(schema.orders).values(order);
    const grant = {
      studentId: student.id,
      courseId: course.courseId,
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 1000),
      source: "order" as const,
      orderId: order.id,
    };
    await conn.insert(schema.entitlements).values({ id: randomUUID(), ...grant });
    await expectPgError(
      conn.insert(schema.entitlements).values({ id: randomUUID(), ...grant }),
      "23505",
    );
  });

  it("has the mock gateway table", async () => {
    const result = await conn.execute(
      sql`select count(*)::int as n from information_schema.tables where table_name = 'mock_gateway_invoices'`,
    );
    expect((result as unknown as Array<{ n: number }>)[0]?.n).toBe(1);
  });
});
