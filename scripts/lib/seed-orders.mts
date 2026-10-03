// Shared by db:seed and db:seed:demo: one paid sample order plus its entitlement for a student, so a
// seeded student can open a paid lesson. Import dynamically, after the guards: it loads server modules.
import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { v7 as uuidv7 } from "uuid";
import {
  courseRevisions,
  courses,
  entitlements,
  orders,
  platformSettings,
  quizAttempts,
  quizzes,
} from "../../src/server/db/schema";
import { computeAccessWindow } from "../../src/server/orders/access-window";

const DEFAULT_COMMISSION_BP = 7000;

/**
 * Idempotent on `orderNumber` (fixed per account): a second run changes nothing. Picks the first
 * published sample course whose access is still open. Sample rows post no journals (MASTER-PLAN 3.5).
 */
export async function seedSampleOrder(
  db: PostgresJsDatabase,
  studentId: string,
  orderNumber: string,
): Promise<"created" | "exists" | "no_course"> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.number, orderNumber))
      .limit(1);
    if (existing) return "exists";

    const candidates = await tx
      .select({
        courseId: courses.id,
        revisionId: courseRevisions.id,
        priceMinor: courseRevisions.priceMinor,
        accessKind: courseRevisions.accessKind,
        accessEndAt: courseRevisions.accessEndAt,
        accessDays: courseRevisions.accessDays,
      })
      .from(courses)
      .innerJoin(courseRevisions, eq(courseRevisions.id, courses.publishedRevisionId))
      .where(and(eq(courses.status, "published"), eq(courses.isSample, true)))
      .orderBy(asc(courses.slug));
    const course = candidates
      .map((row) => ({
        row,
        window:
          row.accessKind === "fixed_end" && row.accessEndAt
            ? computeAccessWindow(now, { kind: "fixed_end", endAt: row.accessEndAt })
            : row.accessDays
              ? computeAccessWindow(now, { kind: "duration_days", days: row.accessDays })
              : null,
      }))
      .find((candidate) => candidate.window !== null);
    if (!course?.window) return "no_course";

    const [settings] = await tx
      .select({
        currency: platformSettings.currency,
        commissionBp: platformSettings.defaultCommissionBp,
      })
      .from(platformSettings)
      .where(eq(platformSettings.id, 1))
      .limit(1);

    const orderId = uuidv7();
    await tx.insert(orders).values({
      id: orderId,
      number: orderNumber,
      buyerId: studentId,
      beneficiaryStudentId: studentId,
      courseId: course.row.courseId,
      courseRevisionId: course.row.revisionId,
      status: "paid",
      listPriceMinor: course.row.priceMinor,
      discountMinor: 0,
      amountMinor: course.row.priceMinor,
      currency: settings?.currency ?? "AED",
      teacherRateBp: settings?.commissionBp ?? DEFAULT_COMMISSION_BP,
      expiresAt: now,
      paidAt: now,
      isSample: true,
    });
    await tx
      .insert(entitlements)
      .values({
        id: uuidv7(),
        studentId,
        courseId: course.row.courseId,
        startsAt: course.window.startsAt,
        endsAt: course.window.endsAt,
        source: "order",
        orderId,
        isSample: true,
      })
      .onConflictDoNothing({ target: entitlements.orderId });
    return "created";
  });
}

/**
 * One submitted sample attempt (75%) on the quiz of a sample course the student owns, so the
 * landing's "Latest quiz results" has something to show. Idempotent on (student, quiz, attempt 1).
 */
export async function seedSampleAttempt(
  db: PostgresJsDatabase,
  studentId: string,
): Promise<"created" | "exists" | "no_quiz"> {
  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(entitlements)
    .innerJoin(quizzes, eq(quizzes.courseId, entitlements.courseId))
    .where(and(eq(entitlements.studentId, studentId), eq(quizzes.isSample, true)))
    .orderBy(asc(quizzes.id))
    .limit(1);
  if (!quiz) return "no_quiz";
  const now = new Date();
  const inserted = await db
    .insert(quizAttempts)
    .values({
      id: uuidv7(),
      studentId,
      quizId: quiz.id,
      attemptNo: 1,
      startedAt: new Date(now.getTime() - 15 * 60 * 1000),
      submittedAt: new Date(now.getTime() - 10 * 60 * 1000),
      scorePct: 75,
      isSample: true,
    })
    .onConflictDoNothing()
    .returning({ id: quizAttempts.id });
  return inserted.length > 0 ? "created" : "exists";
}
