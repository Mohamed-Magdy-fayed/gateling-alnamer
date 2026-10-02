import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Theme = "light" | "dark";
type Pair = { fg: string; bg: string; min: number };

const BODY = 4.5;
const UI = 3;

// Exactly the DESIGN.md 2.3 pairs.
const PAIRS: readonly Pair[] = [
  { fg: "text-primary", bg: "surface-canvas", min: BODY },
  { fg: "text-secondary", bg: "surface-canvas", min: BODY },
  { fg: "text-muted", bg: "surface-canvas", min: BODY },
  { fg: "text-muted", bg: "surface-sunken", min: BODY },
  { fg: "primary-fg", bg: "primary", min: BODY },
  { fg: "primary", bg: "surface-canvas", min: BODY },
  { fg: "primary-soft-fg", bg: "primary-soft", min: BODY },
  { fg: "highlight-fg", bg: "highlight", min: BODY },
  { fg: "highlight-text", bg: "surface-canvas", min: BODY },
  { fg: "success", bg: "success-soft", min: BODY },
  { fg: "warning", bg: "warning-soft", min: BODY },
  { fg: "danger", bg: "danger-soft", min: BODY },
  { fg: "info", bg: "info-soft", min: BODY },
  { fg: "focus", bg: "surface-canvas", min: BODY },
  { fg: "border-strong", bg: "surface-raised", min: UI },
  { fg: "text-inverse", bg: "surface-inverse", min: BODY },
];

const css = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

function blockAfter(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function parseHex(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = m;
    if (name && value) map.set(name, value);
  }
  return map;
}

const light = parseHex(blockAfter(":root {"));
const dark = new Map([...light, ...parseHex(blockAfter(':root[data-theme="dark"]'))]);
const mediaDark = new Map([...light, ...parseHex(blockAfter(':root:not([data-theme="light"])'))]);

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function colour(theme: Theme, name: string): string {
  const value = (theme === "light" ? light : dark).get(name);
  if (!value) throw new Error(`token --${name} missing in ${theme}`);
  return value;
}

describe("tokens.css contrast (DESIGN 2.3)", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      for (const { fg, bg, min } of PAIRS) {
        it(`${fg} on ${bg} >= ${min}:1`, () => {
          const ratio = contrast(colour(theme, fg), colour(theme, bg));
          expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  it("the prefers-color-scheme dark block matches the explicit dark block", () => {
    for (const [name, value] of dark) {
      expect(mediaDark.get(name), `--${name}`).toBe(value);
    }
  });

  it("defines --overlay for light and dark", () => {
    expect(css).toContain("--overlay: rgb(16 38 43 / 0.48);");
    expect(css).toContain("--overlay: rgb(0 0 0 / 0.6);");
  });
});
