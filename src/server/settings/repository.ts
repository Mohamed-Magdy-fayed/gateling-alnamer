import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { type DbExecutor, db } from "@/server/db";
import { type PlatformSettings, platformSettings } from "@/server/db/schema";

export async function readPlatformSettings(executor: DbExecutor): Promise<PlatformSettings> {
  const [row] = await executor.select().from(platformSettings).where(eq(platformSettings.id, 1));
  if (!row) throw new Error("platform_settings row is missing; run `npm run db:migrate`.");
  return row;
}

/** The single settings row, cached per request. */
export const getPlatformSettings = cache(() => readPlatformSettings(db()));
