import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/server/db/migrations");

describe("generated migrations", () => {
  // drizzle-kit emits `"undefined"."<type>"` when altering a column to a customType (seen with
  // citext in 0013, which was corrected by hand under decision D29). Catch any repeat.
  it('never reference an "undefined" schema', () => {
    const offenders = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) =>
        readFileSync(path.join(MIGRATIONS_DIR, name), "utf8").includes('"undefined".'),
      );
    expect(offenders).toEqual([]);
  });
});
