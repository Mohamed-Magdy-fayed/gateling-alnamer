import type { Dictionary } from "@/i18n/ar";
import type { Locale } from "@/i18n/config";
import { pickText } from "@/lib/localized-text";
import type { TeacherOnboardingState } from "@/server/catalog/teachers/profile";
import { Alert, Card } from "@/ui";
import { TermsCard } from "./terms-card";

type TeachersText = Dictionary["teachers"];

type Props = { t: TeachersText; locale: Locale; state: TeacherOnboardingState };

/**
 * What a teacher sees before authoring (C1): the review status, the rejection reason, a suspension
 * notice, or the terms to accept. Shown only while the teacher cannot author.
 */
export function TeacherOnboarding({ t, locale, state }: Props) {
  if (state.status === "approved") {
    // Approved but no terms are published: nothing to accept, nothing to author yet.
    if (!state.termsToAccept) return <Alert tone="warning">{t.status.unavailable}</Alert>;
    return (
      <TermsCard
        t={t}
        versionId={state.termsToAccept.id}
        body={pickText(state.termsToAccept.body, locale)}
        isPlaceholder={state.termsToAccept.isPlaceholder}
      />
    );
  }
  if (state.status === "applied") {
    return (
      <Card className="flex max-w-2xl flex-col gap-2 p-6" data-testid="teacher-status">
        <h2 className="text-lg font-semibold">{t.status.appliedTitle}</h2>
        <p className="text-sm text-fg-2">{t.status.appliedBody}</p>
      </Card>
    );
  }
  if (state.status === "rejected") {
    return (
      <Card className="flex max-w-2xl flex-col gap-3 p-6" data-testid="teacher-status">
        <h2 className="text-lg font-semibold">{t.status.rejectedTitle}</h2>
        {state.decisionReason ? (
          <Alert tone="danger">
            <span className="font-medium">{t.status.reasonLabel}</span>{" "}
            <bdi>{state.decisionReason}</bdi>
          </Alert>
        ) : null}
        <p className="text-sm text-fg-2">{t.status.rejectedBody}</p>
      </Card>
    );
  }
  return (
    <Alert tone="warning">
      <span className="font-medium">{t.status.suspendedTitle}</span> {t.status.suspendedBody}
    </Alert>
  );
}
