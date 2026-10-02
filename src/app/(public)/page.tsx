import {
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  CreditCard,
  FileText,
  GraduationCap,
  Lock,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { pickText } from "@/lib/localized-text";
import { formatPrice } from "@/lib/money-format";
import { getPublishedCourseBySlug, listPublishedCourses } from "@/server/catalog/repository";
import { Badge, ButtonLink, Card, Container, GeometricPattern, Ltr } from "@/ui";

const roleIcons = [GraduationCap, Users, UserRound];
const buyingIcons = [CreditCard, CalendarClock, ShieldCheck, PlayCircle];

export default async function HomePage() {
  const { t, locale } = await getDictionary();
  const [firstCourse] = await listPublishedCourses();
  const sample = firstCourse ? await getPublishedCourseBySlug(firstCourse.slug) : null;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <GeometricPattern className="text-primary opacity-[0.07]" />
        <Container
          size="marketing"
          className="relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]"
        >
          <div className="flex flex-col gap-6">
            <h1 className="text-[clamp(2.25rem,1.6rem+2.8vw,3.75rem)] leading-[1.2] font-bold">
              {t.home.heroTitleStart}{" "}
              <span className="relative inline-block text-primary">
                {t.home.heroTitleHighlight}
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-1 h-2 rounded-full bg-highlight/70"
                />
              </span>{" "}
              {t.home.heroTitleEnd}
            </h1>
            <p className="max-w-[60ch] text-lg leading-[1.8] text-fg-2">{t.home.heroLead}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/courses" size="lg">
                {t.home.heroPrimary}
              </ButtonLink>
              <ButtonLink href="/sign-up?role=teacher" variant="outline" size="lg">
                {t.home.heroSecondary}
              </ButtonLink>
            </div>
          </div>

          {sample ? (
            <Card className="relative rounded-[var(--radius-xl)] p-5 shadow-e3 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <Badge tone="highlight">{t.common.sample}</Badge>
                  <h2 className="mt-3 text-xl font-semibold">
                    <bdi>{pickText(sample.title, locale)}</bdi>
                  </h2>
                  <p className="text-sm text-fg-muted">
                    <bdi>{pickText(sample.teacher.name, locale)}</bdi>
                  </p>
                </div>
                <p className="text-lg font-semibold text-primary">
                  <Ltr>{formatPrice(locale, sample.priceMinor, t.common.currency)}</Ltr>
                </p>
              </div>
              <p className="mb-2 text-sm font-medium text-fg-2">{t.home.vignetteLessons}</p>
              <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-md)] border border-line">
                {sample.sections[0]?.lessons.slice(0, 3).map((lesson) => (
                  <li key={lesson.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    {lesson.kind === "pdf" ? (
                      <FileText aria-hidden className="size-4 text-fg-muted" strokeWidth={1.75} />
                    ) : (
                      <PlayCircle aria-hidden className="size-4 text-fg-muted" strokeWidth={1.75} />
                    )}
                    <span className="flex-1">
                      <bdi>{pickText(lesson.title, locale)}</bdi>
                    </span>
                    {lesson.isFreePreview ? (
                      <Badge tone="success">{t.courses.freePreview}</Badge>
                    ) : (
                      <Lock aria-label={t.courses.locked} className="size-4 text-fg-muted" />
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-sunken px-3 py-2 text-xs text-fg-2">
                <ShieldCheck aria-hidden className="size-4 text-primary" strokeWidth={1.75} />
                {t.home.vignetteWatermark}
                <span className="ms-auto font-medium text-fg-muted">
                  <Ltr>#AN-48213</Ltr>
                </span>
              </div>
            </Card>
          ) : null}
        </Container>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-raised py-16 md:py-24">
        <Container size="marketing">
          <h2 className="text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
            {t.home.rolesTitle}
          </h2>
          <p className="mt-2 text-fg-2">{t.home.rolesLead}</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {t.home.roles.map((role, index) => {
              const Icon = roleIcons[index] ?? GraduationCap;
              return (
                <div key={role.key} className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-primary-soft text-primary-soft-fg">
                      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                    </span>
                    <h3 className="text-lg font-semibold">{role.label}</h3>
                  </div>
                  <ol className="flex flex-col gap-3 border-s-2 border-line ps-5">
                    {role.steps.map((step, stepIndex) => (
                      <li key={step} className="relative text-fg-2">
                        <span
                          aria-hidden
                          className="absolute -start-[31px] top-1 flex size-5 items-center justify-center rounded-full bg-raised text-xs font-semibold text-primary ring-2 ring-line"
                        >
                          <Ltr>{stepIndex + 1}</Ltr>
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      {/* Browse */}
      <section className="py-16 md:py-20">
        <Container size="marketing">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
              {t.home.browseTitle}
            </h2>
            <Badge tone="highlight">{t.common.sample}</Badge>
          </div>
          <p className="mt-2 text-fg-2">{t.home.browseLead}</p>
          <div className="mt-8 flex flex-col gap-5">
            {[
              { label: t.courses.filterCurriculum, items: t.home.curricula },
              { label: t.courses.filterGrade, items: t.home.grades },
              { label: t.courses.filterSubject, items: t.home.subjects },
            ].map((group) => (
              <div key={group.label} className="flex flex-wrap items-center gap-2">
                <span className="w-full text-sm font-medium text-fg-muted sm:w-24">
                  {group.label}
                </span>
                {group.items.map((item) => (
                  <Link
                    key={item}
                    href="/courses"
                    className="rounded-full border border-line-strong bg-raised px-4 py-2 text-sm text-fg transition-shadow hover:shadow-e2"
                  >
                    {item}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Buying */}
      <section className="bg-sunken py-16 md:py-24">
        <Container size="marketing">
          <h2 className="text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
            {t.home.buyingTitle}
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3 md:grid-rows-2">
            {t.home.buying.map((fact, index) => {
              const Icon = buyingIcons[index] ?? CreditCard;
              return (
                <Card
                  key={fact.title}
                  className={
                    index === 0
                      ? "flex flex-col gap-3 p-6 md:row-span-2"
                      : "flex flex-col gap-2 p-6"
                  }
                >
                  <Icon aria-hidden className="size-6 text-primary" strokeWidth={1.75} />
                  <h3 className="text-lg font-semibold">{fact.title}</h3>
                  <p className="text-fg-2">{fact.body}</p>
                  {index === 0 && sample ? (
                    <div className="mt-auto flex flex-col gap-1 rounded-[var(--radius-md)] bg-primary-soft p-4">
                      <span className="text-xs text-primary-soft-fg">
                        {t.home.priceExampleLabel} · {t.common.sample}
                      </span>
                      <span className="text-2xl font-bold text-primary-soft-fg">
                        <Ltr>{formatPrice(locale, sample.priceMinor, t.common.currency)}</Ltr>
                      </span>
                      <span className="text-sm text-primary-soft-fg">{t.home.accessExample}</span>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </Container>
      </section>

      {/* Protection */}
      <section className="py-16 md:py-24">
        <Container size="marketing" className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck aria-hidden className="size-10 text-primary" strokeWidth={1.5} />
            <h2 className="mt-4 text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
              {t.home.protectionTitle}
            </h2>
          </div>
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {t.home.protection.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <BadgeCheck
                    aria-hidden
                    className="mt-1 size-5 shrink-0 text-success"
                    strokeWidth={1.75}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-[var(--radius-md)] border border-line bg-raised p-4 text-sm text-fg-2">
              {t.home.protectionNote}
            </p>
          </div>
        </Container>
      </section>

      {/* Teachers */}
      <section
        id="teachers"
        className="relative scroll-mt-20 overflow-hidden bg-inverse text-fg-inverse"
      >
        <GeometricPattern className="text-fg-inverse opacity-[0.08]" />
        <Container size="marketing" className="relative flex flex-col gap-6 py-16 md:py-20">
          <Sparkles aria-hidden className="size-8 text-highlight" strokeWidth={1.5} />
          <h2 className="max-w-3xl text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
            {t.home.teacherTitle}
          </h2>
          <p className="max-w-2xl text-fg-inverse/85">{t.home.teacherBody}</p>
          <div>
            <ButtonLink
              href="/sign-up?role=teacher"
              size="lg"
              className="bg-highlight text-highlight-fg hover:bg-highlight/90"
            >
              {t.home.teacherCta}
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 py-16 md:py-24">
        <Container size="marketing" className="max-w-3xl">
          <h2 className="text-[clamp(1.5rem,1.3rem+0.9vw,1.875rem)] font-semibold">
            {t.home.faqTitle}
          </h2>
          <div className="mt-8 flex flex-col gap-3">
            {t.home.faq.map((item) => (
              <details
                key={item.q}
                className="group rounded-[var(--radius-md)] border border-line bg-raised px-5 open:shadow-e2"
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown
                    aria-hidden
                    className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    strokeWidth={1.75}
                  />
                </summary>
                <p className="pb-5 text-fg-2">{item.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
