import { getDictionary } from "@/i18n/server";
import { ButtonLink, Container } from "@/ui";

export default async function NotFound() {
  const { t } = await getDictionary();
  return (
    <main id="main">
      <Container className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-3xl font-bold">{t.notFound.title}</h1>
        <ButtonLink href="/">{t.notFound.back}</ButtonLink>
      </Container>
    </main>
  );
}
