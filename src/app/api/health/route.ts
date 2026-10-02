import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { serverEnv } from "@/server/env";
import { getRedis } from "@/server/redis";

export const dynamic = "force-dynamic";

type CheckResult = "ok" | "down" | "skipped";

const CHECK_TIMEOUT_MS = 1000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function check(run: (() => Promise<unknown>) | null): Promise<CheckResult> {
  if (!run) return "skipped";
  try {
    await withTimeout(Promise.resolve().then(run));
    return "ok";
  } catch (error) {
    console.error("[health] check failed", error instanceof Error ? error.message : "unknown");
    return "down";
  }
}

export async function GET() {
  const redis = getRedis();
  const [dbResult, redisResult] = await Promise.all([
    check(() => db().execute(sql`select 1`)),
    check(redis ? () => redis.ping() : null),
  ]);
  const checks = { db: dbResult, redis: redisResult };
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
