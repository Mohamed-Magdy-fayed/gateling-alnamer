import "server-only";
import type { AccessGranted } from "@/server/access/lesson-access";
import type { LessonVideo } from "@/server/access/lesson-media";
import { authKey } from "@/server/auth/keys";
import { VIDEO_TOKEN_TTL_S } from "@/server/config/policy";
import { playbackParams } from "./sign";

export type Playback = { url: string; expiresAt: Date };

/** Whether this build can play the video: only bundled sample assets until D2 adds Bunny. */
export function canPlay(video: LessonVideo): boolean {
  return video.provider === "sample" && video.isSample;
}

/** Sample media served by the app: files under media/sample, keyed by asset row. */
export const SAMPLE_MEDIA_PATH = "/api/media/sample";

/**
 * A short-lived playback URL for a lesson video. It takes the `AccessGranted` from
 * `getLessonAccess`, so no code path can issue one without the access decision; the URL is bound
 * to the asset, the lesson, the viewer and the viewer's device (MASTER-PLAN 3.4).
 *
 * The `sample` provider serves bundled files in every environment, but only for `is_sample`
 * assets (MASTER-PLAN T8). Bunny playback arrives with D2.
 */
export function issuePlayback(
  grant: AccessGranted,
  video: LessonVideo,
  viewer: { deviceId: string | null },
  now: Date,
  key: Buffer = authKey("media"),
): Playback {
  if (video.provider !== "sample" || !video.isSample) {
    throw new Error(`video provider "${video.provider}" is not implemented yet (D2)`);
  }
  const expiresAtS = Math.floor(now.getTime() / 1000) + VIDEO_TOKEN_TTL_S;
  const params = playbackParams(key, {
    assetId: video.id,
    lessonId: grant.lessonId,
    userId: grant.userId,
    deviceId: grant.userId ? viewer.deviceId : null,
    expiresAtS,
  });
  return {
    url: `${SAMPLE_MEDIA_PATH}/${video.id}?${params.toString()}`,
    expiresAt: new Date(expiresAtS * 1000),
  };
}
