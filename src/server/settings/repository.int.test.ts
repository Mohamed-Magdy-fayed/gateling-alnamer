import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { readPlatformSettings } from "./repository";

const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
const conn = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

describe("platform settings", () => {
  it("has the default row after migrate", async () => {
    const row = await readPlatformSettings(conn);
    expect(row).toMatchObject({
      id: 1,
      currency: "AED",
      deviceLimit: 2,
      deviceLimitMode: "strict",
      refundWindowDays: 7,
      refundMaxOpenedPct: 25,
      defaultCommissionBp: 7000,
      gatewayFeeBp: 250,
      invoiceTtlHours: 24,
      sampleHiddenAt: null,
    });
  });

  it("is unchanged by a second migrate", async () => {
    const before = await readPlatformSettings(conn);
    await migrate(conn, {
      migrationsFolder: "src/server/db/migrations",
      migrationsTable: "__alnamer_migrations",
    });
    const after = await readPlatformSettings(conn);
    expect(after).toEqual(before);
    const [count] = await client`select count(*)::int as n from platform_settings`;
    expect(count?.n).toBe(1);
  });

  it("refuses a second row", async () => {
    await expect(client`insert into platform_settings (id) values (2)`).rejects.toThrow();
  });
});
