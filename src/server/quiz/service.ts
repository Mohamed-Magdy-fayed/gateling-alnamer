import "server-only";
import {
  type AccessDenialReason,
  type AccessUser,
  getLessonAccess,
} from "@/server/access/lesson-access";
import {
  getQuizState,
  type QuizState,
  type StartResult,
  type SubmitResult,
  startQuiz,
  submitQuiz,
} from "@/server/access/quiz";
import { type AbuseDeps, guardQuiz } from "@/server/auth/abuse";
import { clock } from "@/server/clock";

export type Denied = { ok: false; reason: AccessDenialReason | "rate_limited" | "no_quiz" };

/** The quiz on a lesson for the caller, after the access decision with the session's device. */
export async function quizStateFor(
  user: AccessUser,
  lessonId: string,
): Promise<{ ok: true; state: QuizState } | Denied> {
  const access = await getLessonAccess(user, lessonId, clock.now());
  if (!access.allowed) return { ok: false, reason: access.reason };
  const state = await getQuizState(access.grant, user.role);
  return state ? { ok: true, state } : { ok: false, reason: "no_quiz" };
}

/** Starts (or resumes) an attempt: rate limit, access decision, then the attempt rules. */
export async function startQuizFor(
  user: AccessUser,
  lessonId: string,
  deps: AbuseDeps = {},
): Promise<StartResult | Denied> {
  const guard = await guardQuiz({ userId: user.id }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };
  const now = clock.now();
  const access = await getLessonAccess(user, lessonId, now);
  if (!access.allowed) return { ok: false, reason: access.reason };
  return startQuiz(access.grant, user.role, now);
}

/** Submits the caller's open attempt: rate limit and the access decision run again at submit. */
export async function submitQuizFor(
  user: AccessUser,
  lessonId: string,
  attemptId: string,
  answers: unknown,
  deps: AbuseDeps = {},
): Promise<SubmitResult | Denied> {
  const guard = await guardQuiz({ userId: user.id }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };
  const now = clock.now();
  const access = await getLessonAccess(user, lessonId, now);
  if (!access.allowed) return { ok: false, reason: access.reason };
  return submitQuiz(access.grant, user.role, attemptId, answers, now);
}
