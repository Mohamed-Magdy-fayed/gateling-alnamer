import "server-only";
import {
  type AccessDenialReason,
  type AccessUser,
  getLessonAccess,
} from "@/server/access/lesson-access";
import { loadLessonVideo } from "@/server/access/lesson-media";
import { type AbuseDeps, guardPlayback } from "@/server/auth/abuse";
import { clock } from "@/server/clock";
import { canPlay, issuePlayback } from "./provider";

export type PlaybackResult =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: AccessDenialReason | "no_video" | "rate_limited" };

/**
 * The token endpoint's logic: rate limit, the single access decision with the session's device,
 * then a short-lived URL for the lesson's video. A denial carries the access reason only.
 */
export async function requestPlayback(
  user: AccessUser,
  lessonId: string,
  deps: AbuseDeps & { key?: Buffer } = {},
): Promise<PlaybackResult> {
  const guard = await guardPlayback({ userId: user.id }, deps);
  if (!("ok" in guard)) return { ok: false, reason: "rate_limited" };
  const now = clock.now();
  const access = await getLessonAccess(user, lessonId, now);
  if (!access.allowed) return { ok: false, reason: access.reason };
  const video = await loadLessonVideo(access.grant);
  // A provider this build cannot play yet (Bunny arrives with D2) reads as no video, not an error.
  if (!video || !canPlay(video)) return { ok: false, reason: "no_video" };
  const playback = issuePlayback(access.grant, video, { deviceId: user.deviceId }, now, deps.key);
  return { ok: true, url: playback.url, expiresAt: playback.expiresAt };
}
