import Link from "next/link";
import type { Dictionary } from "@/i18n/ar";
import { Alert, Container } from "@/ui";

/** Dashboard notice for a signed-in user whose email is not confirmed yet. */
export function VerifyBanner({ t, email }: { t: Dictionary; email: string }) {
  // The address is an LTR island inside the sentence, whatever the page direction.
  const [before = "", after = ""] = t.auth.states.verifyBanner.split("{email}");
  return (
    <Container className="pt-6">
      <Alert tone="info">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p>
            {before}
            <bdi dir="ltr">{email}</bdi>
            {after}
          </p>
          <Link
            href="/verify-email"
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            {t.auth.verify.bannerAction}
          </Link>
        </div>
      </Alert>
    </Container>
  );
}
