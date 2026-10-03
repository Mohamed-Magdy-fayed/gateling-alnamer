"use client";

import { House, Link2, type LucideIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavIconName } from "./nav";

const ICONS: Record<NavIconName, LucideIcon> = { home: House, account: UserRound, link: Link2 };

export type ShellNavItem = { href: string; label: string; icon: NavIconName };

/** The home item is active only on its own path; the others also own their sub-paths. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The per-role nav list, shared by the desktop sidebar and the mobile Sheet. `aria-current` marks the page. */
export function ShellNav({
  items,
  label,
  wrap,
}: {
  items: readonly ShellNavItem[];
  label: string;
  /** Wraps each link (the Sheet uses it to close on navigation). */
  wrap?: (link: React.ReactElement, key: string) => React.ReactElement;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          const link = (
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium",
                active
                  ? "bg-primary-soft text-primary-soft-fg"
                  : "text-fg-2 hover:bg-sunken hover:text-fg",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
          return <li key={item.href}>{wrap ? wrap(link, item.href) : link}</li>;
        })}
      </ul>
    </nav>
  );
}
