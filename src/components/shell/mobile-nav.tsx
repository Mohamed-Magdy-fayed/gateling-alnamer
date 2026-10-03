"use client";

import { Menu } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ShellNav, type ShellNavItem } from "./shell-nav";

type Labels = { open: string; close: string; title: string; nav: string };

/** Below 1024px the sidebar is this Sheet from the inline-start edge. Radix traps focus, closes on Escape and returns focus to the trigger. */
export function MobileNav({ items, labels }: { items: readonly ShellNavItem[]; labels: Labels }) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label={labels.open}
        className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] hover:bg-sunken lg:hidden"
      >
        <Menu aria-hidden className="size-5" strokeWidth={1.75} />
      </SheetTrigger>
      <SheetContent side="start" closeLabel={labels.close} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{labels.title}</SheetTitle>
        </SheetHeader>
        <ShellNav
          items={items}
          label={labels.nav}
          wrap={(link, key) => (
            <SheetClose key={key} asChild>
              {link}
            </SheetClose>
          )}
        />
      </SheetContent>
    </Sheet>
  );
}
