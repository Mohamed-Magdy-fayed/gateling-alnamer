import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { Alert, Container } from "@/ui";

const pages = ["terms", "privacy", "refunds"] as const;
type LegalPage = (typeof pages)[number];

function isLegalPage(value: string): value is LegalPage {
  return (pages as readonly string[]).includes(value);
}

export function generateStaticParams() {
  return pages.map((page) => ({ page }));
}

export default async function LegalPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!isLegalPage(page)) notFound();
  const { t } = await getDictionary();
  return (
    <Container className="max-w-3xl py-14">
      <h1 className="mb-6 text-[clamp(1.875rem,1.5rem+1.6vw,2.5rem)] font-bold">{t.legal[page]}</h1>
      <Alert>{t.legal.pending}</Alert>
    </Container>
  );
}
