import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { issuePreSession } from "./pre-session";
import { registerOrBlock } from "./service";

export type DeviceGate =
  /** `deviceId` is null for roles the limit does not cover. `overLimit` is a soft-mode warning. */
  { kind: "allowed"; deviceId: string | null; overLimit: boolean } | { kind: "blocked" };

export type DeviceGateContext = {
  /** The signed `did` cookie's id (see `requestContext`). */
  deviceKey: string;
  userAgent: string | null;
  secure: boolean;
};

/**
 * The device step of sign-in, after a correct password. Only students are limited. A blocked
 * student gets a pre-session cookie and no session: the caller sends them to /devices/blocked.
 */
export async function gateDevice(userId: string, ctx: DeviceGateContext): Promise<DeviceGate> {
  const [user] = await db()
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.role !== "student") return { kind: "allowed", deviceId: null, overLimit: false };

  const result = await registerOrBlock(userId, ctx.deviceKey, ctx.userAgent);
  if (result.outcome === "block") {
    await issuePreSession(userId, ctx.deviceKey, { secure: ctx.secure });
    return { kind: "blocked" };
  }
  return {
    kind: "allowed",
    deviceId: result.deviceId,
    overLimit: result.outcome === "registerOver",
  };
}
