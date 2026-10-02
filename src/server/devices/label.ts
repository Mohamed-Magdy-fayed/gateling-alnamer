const MAX_LABEL_LENGTH = 80;

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

// iOS before macOS (iPhone UAs say "like Mac OS X"); Android before Linux.
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone|\biPad|\biPod/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X|\bMacintosh/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(table: readonly (readonly [RegExp, string])[], ua: string): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(ua)) return name;
  }
  return null;
}

/** "Chrome on Windows" from a User-Agent, or null when unknown (the caller shows the i18n unknownDevice). */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const browser = firstMatch(BROWSERS, userAgent);
  const system = firstMatch(SYSTEMS, userAgent);
  const label = browser && system ? `${browser} on ${system}` : (browser ?? system);
  return label ? label.slice(0, MAX_LABEL_LENGTH) : null;
}
