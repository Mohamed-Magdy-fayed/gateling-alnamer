"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/theme-actions";
import { format } from "@/i18n/config";
import { nextTheme, type Theme } from "@/lib/theme";
import { Button } from "@/ui";

type Labels = {
  toLight: string;
  toDark: string;
  toSystem: string;
  /** Template with a `{theme}` slot. */
  current: string;
  names: Record<Theme, string>;
};

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function resolve(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolve(theme);
}

export function ThemeToggle({ initial, labels }: { initial: Theme; labels: Labels }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [isPending, startTransition] = useTransition();
  const next = nextTheme(theme);
  const Icon = ICONS[theme];
  const label =
    next === "light" ? labels.toLight : next === "dark" ? labels.toDark : labels.toSystem;

  function change() {
    const previous = theme;
    setTheme(next);
    applyTheme(next);
    startTransition(async () => {
      try {
        await setThemeAction(next);
      } catch {
        setTheme(previous);
        applyTheme(previous);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      disabled={isPending}
      className="size-11 p-0"
      onClick={change}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      <span className="sr-only">{format(labels.current, { theme: labels.names[theme] })}</span>
    </Button>
  );
}
