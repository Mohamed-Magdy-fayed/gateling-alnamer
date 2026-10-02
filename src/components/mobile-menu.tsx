"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ButtonLink } from "@/ui";

type Labels = { open: string; close: string; title: string; nav: string };

/** Small-screen navigation in a Sheet on the inline-end edge. Radix handles Escape, outside click and focus return. */
export function MobileMenu({
  links,
  cta,
  labels,
}: {
  links: readonly { href: string; label: string }[];
  /** Primary action, shown under the links below `sm` where the header has no room for it. */
  cta: { href: string; label: string };
  labels: Labels;
}) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label={labels.open}
        className="flex size-11 items-center justify-center rounded-[var(--radius-md)] hover:bg-sunken lg:hidden"
      >
        <Menu aria-hidden className="size-5" strokeWidth={1.75} />
      </SheetTrigger>
      <SheetContent closeLabel={labels.close} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{labels.title}</SheetTitle>
        </SheetHeader>
        <nav aria-label={labels.nav}>
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <SheetClose asChild>
                  <Link
                    href={link.href}
                    className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-fg hover:bg-sunken"
                  >
                    {link.label}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>
        <SheetClose asChild>
          <ButtonLink href={cta.href} className="mt-auto sm:hidden">
            {cta.label}
          </ButtonLink>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
