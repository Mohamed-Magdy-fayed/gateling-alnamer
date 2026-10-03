import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LinkParentForm } from "@/components/parents/link-parent-form";
import { LinkedParents } from "@/components/parents/linked-parents";
import { getDictionary } from "@/i18n/server";
import { requirePageRole } from "@/server/auth/page-guard";
import { listParentsForStudent } from "@/server/parents/views";
import { Container } from "@/ui";

export default async function LinkParentPage() {
  const user = await requirePageRole("student");
  const [{ t }, parents] = await Promise.all([getDictionary(), listParentsForStudent(user.id)]);
  const texts = { parents: t.parents, auth: t.auth };

  return (
    <Container className="flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-[var(--radius-sm)] text-sm text-fg-2 hover:text-fg"
        >
          <ArrowRight aria-hidden className="size-4 ltr:rotate-180" strokeWidth={1.75} />
          {t.common.dashboard}
        </Link>
        <h1 className="text-2xl font-bold">{t.parents.linkEnter}</h1>
        <LinkParentForm t={texts} />
      </div>
      <LinkedParents parents={parents} t={texts} />
    </Container>
  );
}
