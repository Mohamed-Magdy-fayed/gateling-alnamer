export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];
export const THEME_COOKIE = "theme";
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** Light -> dark -> system -> light. */
export function nextTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
}

/** Constant string: runs before paint when no explicit theme cookie is set. No user input is interpolated. */
export const NO_FLASH_SCRIPT =
  "document.documentElement.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'";
