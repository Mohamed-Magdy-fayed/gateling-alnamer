import { getDictionary } from "@/i18n/server";
import { getTheme } from "@/lib/theme-server";
import { ThemeToggle } from "./theme-toggle";

/** Server wrapper: reads the cookie and the dictionary, hands plain props to the client toggle. */
export async function ThemeSwitch() {
  const [{ t }, theme] = await Promise.all([getDictionary(), getTheme()]);
  return (
    <ThemeToggle
      initial={theme}
      labels={{
        toLight: t.common.theme.toLight,
        toDark: t.common.theme.toDark,
        toSystem: t.common.theme.toSystem,
      }}
    />
  );
}
