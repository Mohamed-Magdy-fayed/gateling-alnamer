import { sql } from "drizzle-orm";

// Anything with an `execute` (a Drizzle transaction).
type SqlRunner = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Serialises everything that decides who holds access to one course for one student: checkout
 * (reuse or open an order) and `confirmPayment` (the duplicate-access check). Taken inside a
 * transaction, released at its end.
 */
export async function lockStudentCourse(
  tx: SqlRunner,
  studentId: string,
  courseId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`order-access:${studentId}:${courseId}`}))`,
  );
}
