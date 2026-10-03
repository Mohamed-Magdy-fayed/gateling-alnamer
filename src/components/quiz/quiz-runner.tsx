"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Dictionary } from "@/i18n/ar";
import { dirOf, format, type Locale, plural } from "@/i18n/config";
import { type LocalizedText, pickText } from "@/lib/localized-text";
import { useTRPC } from "@/lib/trpc/client";
import { Alert, Badge, Button, Card, LoadingSwap, Ltr } from "@/ui";

type QuizText = Dictionary["quiz"];

export type QuizQuestionView = {
  id: string;
  body: LocalizedText;
  options: { id: string; text: LocalizedText }[];
};

export type QuizIntro = {
  title: LocalizedText;
  questionCount: number;
  timeLimitS: number | null;
  passPct: number;
  attemptsLeft: number;
  bestScore: number | null;
  hasOpenAttempt: boolean;
  canAttempt: boolean;
};

type Props = {
  lessonId: string;
  intro: QuizIntro;
  locale: Locale;
  t: QuizText;
  /** The plural forms for "N minutes" (courses.minutes). */
  minutes: Dictionary["courses"]["minutes"];
};

type Phase =
  | { kind: "intro" }
  | {
      kind: "answering";
      attemptId: string;
      deadlineAt: string | null;
      questions: QuizQuestionView[];
    }
  | {
      kind: "result";
      scorePct: number;
      passed: boolean;
      bestScore: number;
      attemptsLeft: number;
      late: boolean;
    };

function cairoTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));
}

/** A sentence with one LTR island in place of `{name}` (word order stays with the translation). */
function withIsland(template: string, name: string, island: ReactNode): ReactNode {
  const [before, after = ""] = template.split(`{${name}}`);
  return (
    <>
      {before}
      {island}
      {after}
    </>
  );
}

/** Intro, then the questions, then the score: one quiz attempt at a time, graded on the server. */
export function QuizRunner({ lessonId, intro, locale, t, minutes }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const start = useMutation(trpc.quiz.start.mutationOptions());
  const submit = useMutation(trpc.quiz.submit.mutationOptions());
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const baseId = useId();
  const dir = dirOf(locale);

  function failure() {
    setError(t.error);
  }

  function begin() {
    setError(null);
    start.mutate(
      { lessonId },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            if (result.reason === "no_attempts_left") setBlocked(t.noAttemptsLeft);
            else if (result.reason === "preview_only") setBlocked(t.previewOnly);
            else setError(t.error);
            return;
          }
          setAnswers({});
          setPhase({
            kind: "answering",
            attemptId: result.attemptId,
            deadlineAt: result.deadlineAt ? new Date(result.deadlineAt).toISOString() : null,
            questions: result.questions,
          });
        },
        onError: failure,
      },
    );
  }

  function send(attemptId: string) {
    setError(null);
    submit.mutate(
      { lessonId, attemptId, answers },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            setError(t.error);
            return;
          }
          setPhase({
            kind: "result",
            scorePct: result.scorePct,
            passed: result.passed,
            bestScore: result.bestScore,
            attemptsLeft: result.attemptsLeft,
            late: result.late,
          });
          router.refresh();
        },
        onError: failure,
      },
    );
  }

  const errorAlert = error ? <Alert tone="danger">{error}</Alert> : null;

  if (phase.kind === "answering") {
    const total = phase.questions.length;
    return (
      <div className="flex flex-col gap-4">
        {phase.deadlineAt ? (
          <p className="text-sm text-fg-muted">
            {withIsland(t.deadline, "time", <Ltr>{cairoTime(locale, phase.deadlineAt)}</Ltr>)}
          </p>
        ) : null}
        {phase.questions.map((question, index) => {
          const legendId = `${baseId}-q${index}`;
          return (
            <Card key={question.id} className="p-5">
              <fieldset className="flex flex-col gap-3">
                <legend id={legendId} className="flex flex-col gap-1">
                  <span className="text-xs text-fg-muted">
                    {format(t.questionLabel, { n: index + 1, total })}
                  </span>
                  <span className="font-semibold">
                    <bdi>{pickText(question.body, locale)}</bdi>
                  </span>
                </legend>
                <RadioGroup
                  dir={dir}
                  value={answers[question.id] ?? ""}
                  onValueChange={(value) =>
                    setAnswers((current) => ({ ...current, [question.id]: value }))
                  }
                  aria-labelledby={legendId}
                  className="sm:grid-cols-2"
                >
                  {question.options.map((option) => (
                    <RadioGroupItem
                      key={option.id}
                      value={option.id}
                      className="justify-start text-start"
                    >
                      <bdi>{pickText(option.text, locale)}</bdi>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </fieldset>
            </Card>
          );
        })}
        {errorAlert}
        <Button
          size="lg"
          className="self-start"
          disabled={submit.isPending}
          onClick={() => send(phase.attemptId)}
        >
          <LoadingSwap pending={submit.isPending}>{t.submit}</LoadingSwap>
        </Button>
      </div>
    );
  }

  if (phase.kind === "result") {
    return (
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold">{format(t.resultTitle, { score: phase.scorePct })}</h2>
          <Badge tone={phase.passed ? "success" : "neutral"}>
            {phase.passed ? t.passed : t.notPassed}
          </Badge>
        </div>
        <p className="text-sm text-fg-2">
          {format(t.bestScore, { score: phase.bestScore })} ·{" "}
          {plural(locale, t.attemptsLeft, phase.attemptsLeft)}
        </p>
        {phase.late ? <Alert tone="warning">{t.late}</Alert> : null}
        {errorAlert}
        {phase.attemptsLeft > 0 ? (
          <Button
            variant="secondary"
            className="min-h-11 self-start"
            disabled={start.isPending}
            onClick={begin}
          >
            <LoadingSwap pending={start.isPending}>{t.tryAgain}</LoadingSwap>
          </Button>
        ) : (
          <p className="text-sm text-fg-muted">{t.noAttemptsLeft}</p>
        )}
      </Card>
    );
  }

  const canStart = intro.canAttempt && (intro.hasOpenAttempt || intro.attemptsLeft > 0);
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">
        <bdi>{pickText(intro.title, locale)}</bdi>
      </h2>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Badge tone="neutral">{plural(locale, t.questions, intro.questionCount)}</Badge>
        </li>
        {intro.timeLimitS ? (
          <li>
            <Badge tone="neutral">
              {format(t.timeLimit, {
                minutes: plural(locale, minutes, Math.ceil(intro.timeLimitS / 60)),
              })}
            </Badge>
          </li>
        ) : null}
        <li>
          <Badge tone="neutral">{format(t.passMark, { pass: intro.passPct })}</Badge>
        </li>
        {intro.canAttempt ? (
          <li>
            <Badge tone="neutral">{plural(locale, t.attemptsLeft, intro.attemptsLeft)}</Badge>
          </li>
        ) : null}
        {intro.bestScore !== null ? (
          <li>
            <Badge tone="success">{format(t.bestScore, { score: intro.bestScore })}</Badge>
          </li>
        ) : null}
      </ul>
      {!intro.canAttempt ? <Alert>{t.previewOnly}</Alert> : null}
      {intro.canAttempt && !canStart ? <Alert>{t.noAttemptsLeft}</Alert> : null}
      {blocked ? <Alert>{blocked}</Alert> : null}
      {errorAlert}
      {canStart && !blocked ? (
        <Button size="lg" className="self-start" disabled={start.isPending} onClick={begin}>
          <LoadingSwap pending={start.isPending}>
            {intro.hasOpenAttempt ? t.resume : t.start}
          </LoadingSwap>
        </Button>
      ) : null}
    </Card>
  );
}
