/** One question's answer key: the correct option and the options it accepts. */
export type AnswerKey = { id: string; correct: string; optionIds: string[] };

/**
 * The submitted answers reduced to known questions answered with one of their own option ids.
 * Anything else (unknown ids, non-string values, a non-object payload) is dropped.
 */
export function cleanAnswers(key: readonly AnswerKey[], raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const question of key) {
    if (!Object.hasOwn(source, question.id)) continue;
    const answer = source[question.id];
    if (typeof answer === "string" && question.optionIds.includes(answer)) {
      clean[question.id] = answer;
    }
  }
  return clean;
}

/** Correct answers over all questions, rounded to a whole percent (unanswered counts as wrong). */
export function scoreAnswers(
  key: readonly AnswerKey[],
  answers: Readonly<Record<string, string>>,
): { correct: number; total: number; pct: number } {
  const total = key.length;
  const correct = key.filter((question) => answers[question.id] === question.correct).length;
  return { correct, total, pct: total === 0 ? 0 : Math.round((100 * correct) / total) };
}
