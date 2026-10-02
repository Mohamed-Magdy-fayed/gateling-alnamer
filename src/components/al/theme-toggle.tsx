"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/theme-actions";
import { nextTheme, type Theme } from "@/lib/theme";
import { Button } from "@/ui";

type Labels = { toLight: string; toDark: string; toSystem: string };

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeToggle({ initial, labels }: { initial: Theme; labels: Labels }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [, startTransition] = useTransition();
  const next = nextTheme(theme);
  const Icon = ICONS[theme];
  const label =
    next === "light" ? labels.toLight : next === "dark" ? labels.toDark : labels.toSystem;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      className="size-11 p-0"
      onClick={() => {
        setTheme(next);
        applyTheme(next);
        startTransition(() => setThemeAction(next));
      }}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
    </Button>
  );
}
