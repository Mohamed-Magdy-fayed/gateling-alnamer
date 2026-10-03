import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { LocalizedText } from "@/lib/localized-text";
import { QUIZ_GRACE_S } from "@/server/config/policy";
import { db } from "@/server/db";
import {
  lessonRevisions,
  lessons,
  type QuestionOption,
  questions,
  quizAttempts,
  quizQuestions,
  quizzes,
} from "@/server/db/schema";
import type { AccessGranted } from "./lesson-access";
import { type AnswerKey, cleanAnswers, scoreAnswers } from "./quiz-score";

type Database = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A question as the student sees it: never the correct option or the explanation. */
export type PublicQuestion = {
  id: string;
  kind: "mcq" | "true_false";
  body: LocalizedText;
  options: QuestionOption[];
};

export type QuizInfo = {
  id: string;
  title: LocalizedText;
  timeLimitS: number | null;
  maxAttempts: number;
  passPct: number;
  questionCount: number;
};

export type AttemptSummary = { attemptNo: number; scorePct: number; submittedAt: Date };

export type QuizState = {
  quiz: QuizInfo;
  submitted: AttemptSummary[];
  open: { id: string; attemptNo: number; deadlineAt: Date | null } | null;
  bestScore: number | null;
  attemptsLeft: number;
  /** Teachers, reviewers and admins see the quiz but do not take attempts. */
  canAttempt: boolean;
};

async function lessonQuiz(executor: Database | Tx, lessonId: string) {
  const [row] = await executor
    .select({
      id: quizzes.id,
      title: quizzes.title,
      timeLimitS: quizzes.timeLimitS,
      maxAttempts: quizzes.maxAttempts,
      passPct: quizzes.passPct,
    })
    .from(lessons)
    .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
    .innerJoin(quizzes, eq(quizzes.id, lessonRevisions.quizId))
    .where(eq(lessons.id, lessonId))
    .limit(1);
  return row ?? null;
}

async function quizQuestionRows(executor: Database | Tx, quizId: string) {
  return executor
    .select({
      id: questions.id,
      kind: questions.kind,
      body: questions.body,
      options: questions.options,
      correct: questions.correct,
    })
    .from(quizQuestions)
    .innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.sort));
}

const toPublic = (row: Awaited<ReturnType<typeof quizQuestionRows>>[number]): PublicQuestion => ({
  id: row.id,
  kind: row.kind,
  body: row.body,
  options: row.options,
});

const toKey = (row: Awaited<ReturnType<typeof quizQuestionRows>>[number]): AnswerKey => ({
  id: row.id,
  correct: row.correct,
  optionIds: row.options.map((option) => option.id),
});

async function attemptsOf(executor: Database | Tx, studentId: string, quizId: string) {
  return executor
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.studentId, studentId), eq(quizAttempts.quizId, quizId)))
    .orderBy(desc(quizAttempts.attemptNo));
}

function stateOf(
  quiz: NonNullable<Awaited<ReturnType<typeof lessonQuiz>>>,
  questionCount: number,
  attempts: Awaited<ReturnType<typeof attemptsOf>>,
  canAttempt: boolean,
): QuizState {
  const submitted = attempts
    .filter((attempt) => attempt.submittedAt !== null && attempt.scorePct !== null)
    .map((attempt) => ({
      attemptNo: attempt.attemptNo,
      scorePct: attempt.scorePct ?? 0,
      submittedAt: attempt.submittedAt ?? new Date(0),
    }));
  const open = attempts.find((attempt) => attempt.submittedAt === null) ?? null;
  return {
    quiz: { ...quiz, questionCount },
    submitted,
    open: open ? { id: open.id, attemptNo: open.attemptNo, deadlineAt: open.deadlineAt } : null,
    bestScore: submitted.length > 0 ? Math.max(...submitted.map((a) => a.scorePct)) : null,
    attemptsLeft: Math.max(0, quiz.maxAttempts - attempts.length),
    canAttempt,
  };
}

const takesAttempts = (grant: AccessGranted) => grant.mode !== "staff_preview" && grant.userId;

/** The lesson's quiz and the caller's attempts; null when the lesson has no quiz. */
export async function getQuizState(grant: AccessGranted): Promise<QuizState | null> {
  const quiz = await lessonQuiz(db(), grant.lessonId);
  if (!quiz) return null;
  const rows = await quizQuestionRows(db(), quiz.id);
  const attempts = grant.userId ? await attemptsOf(db(), grant.userId, quiz.id) : [];
  return stateOf(quiz, rows.length, attempts, Boolean(takesAttempts(grant)));
}

export type StartResult =
  | { ok: true; attemptId: string; deadlineAt: Date | null; questions: PublicQuestion[] }
  | { ok: false; reason: "no_quiz" | "no_attempts_left" | "preview_only" };

/**
 * Starts the next attempt, or returns the open one (a reload resumes it). Serialised per student
 * and quiz, so two clicks never make two attempts; the unique (student, quiz, attempt_no) backs it.
 */
export async function startQuiz(grant: AccessGranted, now: Date): Promise<StartResult> {
  const studentId = takesAttempts(grant);
  if (!studentId) return { ok: false, reason: "preview_only" };
  return db().transaction(async (tx) => {
    const quiz = await lessonQuiz(tx, grant.lessonId);
    if (!quiz) return { ok: false, reason: "no_quiz" };
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`quiz:${studentId}:${quiz.id}`}))`,
    );
    const rows = await quizQuestionRows(tx, quiz.id);
    const attempts = await attemptsOf(tx, studentId, quiz.id);
    const open = attempts.find((attempt) => attempt.submittedAt === null);
    if (open) {
      return {
        ok: true,
        attemptId: open.id,
        deadlineAt: open.deadlineAt,
        questions: rows.map(toPublic),
      };
    }
    if (attempts.length >= quiz.maxAttempts) return { ok: false, reason: "no_attempts_left" };
    const deadlineAt = quiz.timeLimitS ? new Date(now.getTime() + quiz.timeLimitS * 1000) : null;
    const id = uuidv7();
    await tx.insert(quizAttempts).values({
      id,
      studentId,
      quizId: quiz.id,
      attemptNo: (attempts[0]?.attemptNo ?? 0) + 1,
      startedAt: now,
      deadlineAt,
    });
    return { ok: true, attemptId: id, deadlineAt, questions: rows.map(toPublic) };
  });
}

export type SubmitResult =
  | {
      ok: true;
      scorePct: number;
      passed: boolean;
      bestScore: number;
      attemptsLeft: number;
      /** Submitted after the deadline plus grace; still graded as-is (MASTER-PLAN L2). */
      late: boolean;
    }
  | { ok: false; reason: "not_found" | "already_submitted" | "preview_only" };

/** Grades the caller's open attempt in one transaction. Correct answers are not returned (L2). */
export async function submitQuiz(
  grant: AccessGranted,
  attemptId: string,
  rawAnswers: unknown,
  now: Date,
): Promise<SubmitResult> {
  const studentId = takesAttempts(grant);
  if (!studentId) return { ok: false, reason: "preview_only" };
  return db().transaction(async (tx) => {
    const quiz = await lessonQuiz(tx, grant.lessonId);
    if (!quiz) return { ok: false, reason: "not_found" };
    const [attempt] = await tx
      .select()
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.id, attemptId),
          eq(quizAttempts.studentId, studentId),
          eq(quizAttempts.quizId, quiz.id),
        ),
      )
      .for("update");
    if (!attempt) return { ok: false, reason: "not_found" };
    if (attempt.submittedAt) return { ok: false, reason: "already_submitted" };
    const key = (await quizQuestionRows(tx, quiz.id)).map(toKey);
    const answers = cleanAnswers(key, rawAnswers);
    const score = scoreAnswers(key, answers);
    await tx
      .update(quizAttempts)
      .set({ answers, submittedAt: now, scorePct: score.pct })
      .where(and(eq(quizAttempts.id, attempt.id), isNull(quizAttempts.submittedAt)));
    const [best] = await tx
      .select({ best: sql<number>`max(${quizAttempts.scorePct})` })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.studentId, studentId),
          eq(quizAttempts.quizId, quiz.id),
          isNotNull(quizAttempts.submittedAt),
        ),
      );
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.studentId, studentId), eq(quizAttempts.quizId, quiz.id)));
    const late = attempt.deadlineAt
      ? now.getTime() > attempt.deadlineAt.getTime() + QUIZ_GRACE_S * 1000
      : false;
    return {
      ok: true,
      scorePct: score.pct,
      passed: score.pct >= quiz.passPct,
      bestScore: Number(best?.best ?? score.pct),
      attemptsLeft: Math.max(0, quiz.maxAttempts - count),
      late,
    };
  });
}

export type RecentResult = {
  quizTitle: LocalizedText;
  scorePct: number;
  passPct: number;
  submittedAt: Date;
};

/** The student's latest submitted attempts, for the landing card. */
export async function listRecentResults(studentId: string, limit = 3): Promise<RecentResult[]> {
  return db()
    .select({
      quizTitle: quizzes.title,
      scorePct: sql<number>`${quizAttempts.scorePct}`,
      passPct: quizzes.passPct,
      submittedAt: sql<Date>`${quizAttempts.submittedAt}`,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(and(eq(quizAttempts.studentId, studentId), isNotNull(quizAttempts.submittedAt)))
    .orderBy(desc(quizAttempts.submittedAt))
    .limit(limit);
}
