import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";
import { getRedis } from "@/server/redis";

export const dynamic = "force-dynamic";

type CheckResult = "ok" | "down" | "skipped";

async function check(run: (() => Promise<unknown>) | null): Promise<CheckResult> {
  if (!run) return "skipped";
  try {
    await run();
    return "ok";
  } catch (error) {
    console.error("[health] check failed", error instanceof Error ? error.message : "unknown");
    return "down";
  }
}

export async function GET() {
  const redis = getRedis();
  const checks = {
    db: await check(() => db().execute(sql`select 1`)),
    redis: await check(redis ? () => redis.ping() : null),
  };
  const status = checks.db === "down" || checks.redis === "down" ? "degraded" : "ok";
  const headers = { "Cache-Control": "no-store" };
  const httpStatus = status === "ok" ? 200 : 503;

  const user = await getCurrentUser().catch(() => null);
  if (user?.role !== "admin") {
    return NextResponse.json({ status }, { status: httpStatus, headers });
  }
  const env = serverEnv();
  return NextResponse.json(
    { status, checks, appMode: env.APP_MODE, jobsMode: env.providers.jobs },
    { status: httpStatus, headers },
  );
}
