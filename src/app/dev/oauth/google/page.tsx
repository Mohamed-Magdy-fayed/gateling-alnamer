import { notFound } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getDictionary } from "@/i18n/server";
import { currentProvider } from "@/server/auth/oauth/routes";
import { Alert, Card, Container, Field } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";

/** The local mock of Google's consent screen (demo mode off Vercel; the /dev layout guards it). */
export default async function MockGooglePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; code_challenge?: string; redirect_uri?: string }>;
}) {
  if (currentProvider()?.id !== "mock") notFound();
  const params = await searchParams;
  const { t } = await getDictionary();
  const g = t.google;
  return (
    <Container className="py-12">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <Alert tone="warning">{g.mockBanner}</Alert>
        <Card className="p-6">
          <h1 className="mb-4 text-xl font-bold">{g.mockTitle}</h1>
          <form method="get" action="/dev/oauth/google/authorize" className="flex flex-col gap-4">
            <input type="hidden" name="state" value={params.state ?? ""} />
            <input type="hidden" name="code_challenge" value={params.code_challenge ?? ""} />
            <input type="hidden" name="redirect_uri" value={params.redirect_uri ?? ""} />
            <Field name="email" type="email" label={g.mockEmail} required ltr />
            <Field name="name" label={g.mockName} />
            <Label
              htmlFor="field-verified"
              className="flex min-h-11 items-center gap-3 font-normal"
            >
              <Checkbox id="field-verified" name="verified" defaultChecked />
              <span>{g.mockVerified}</span>
            </Label>
            <SubmitButton>{g.mockContinue}</SubmitButton>
          </form>
        </Card>
      </div>
    </Container>
  );
}
