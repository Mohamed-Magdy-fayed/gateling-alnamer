import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { renderEnvMarkdown } from "./env-docs.mjs";

describe("renderEnvMarkdown", () => {
  it("lists every key of .env.example with its comment", () => {
    const text = readFileSync(".env.example", "utf8");
    const markdown = renderEnvMarkdown(text);
    for (const key of Object.keys(parse(text))) {
      expect(markdown).toContain(`\`${key}\``);
    }
    expect(markdown).toContain("Runtime mode");
  });

  it("pairs each key with the comment lines above it and escapes pipes", () => {
    const markdown = renderEnvMarkdown("# first | one\n# second\nFOO=bar\nBAZ=\n# own\nQUX=\n");
    expect(markdown).toContain("| `FOO` | first \\| one second |");
    expect(markdown).toContain("| `QUX` | own |");
    expect(markdown).toMatch(/\| `BAZ` \| *\|/);
  });

  it("never prints example values for secrets", () => {
    const markdown = renderEnvMarkdown("# k\nIBAN_ENCRYPTION_KEY=supersecretvalue\n");
    expect(markdown).not.toContain("supersecretvalue");
  });
});
