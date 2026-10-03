import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { lessonRevisions, lessons, mediaAssets } from "@/server/db/schema";
import type { AccessGranted } from "./lesson-access";

export type LessonVideo = {
  id: string;
  provider: "bunny" | "mock" | "sample" | "firebase" | "local";
  storageKey: string | null;
  providerId: string | null;
  isSample: boolean;
};

/**
 * The video of a lesson the caller may play. Media storage keys are read only here, behind an
 * `AccessGranted` that only `getLessonAccess` can construct (MASTER-PLAN 3.2). Null when the
 * published revision has no ready video.
 */
export async function loadLessonVideo(grant: AccessGranted): Promise<LessonVideo | null> {
  const [row] = await db()
    .select({
      id: mediaAssets.id,
      provider: mediaAssets.provider,
      storageKey: mediaAssets.storageKey,
      providerId: mediaAssets.providerId,
      isSample: mediaAssets.isSample,
      status: mediaAssets.status,
      kind: mediaAssets.kind,
    })
    .from(lessons)
    .innerJoin(lessonRevisions, eq(lessonRevisions.id, lessons.publishedRevisionId))
    .innerJoin(mediaAssets, eq(mediaAssets.id, lessonRevisions.videoAssetId))
    .where(eq(lessons.id, grant.lessonId))
    .limit(1);
  if (row?.status !== "ready" || row.kind !== "video") return null;
  return {
    id: row.id,
    provider: row.provider,
    storageKey: row.storageKey,
    providerId: row.providerId,
    isSample: row.isSample,
  };
}

/**
 * The bundled file behind a sample asset, for the media route after it verified a signed playback
 * URL (the URL was issued behind `AccessGranted`). Only `sample` provider rows marked `is_sample`
 * resolve; the storage key must be a plain file name.
 */
export async function sampleFileName(assetId: string): Promise<string | null> {
  const [row] = await db()
    .select({
      provider: mediaAssets.provider,
      storageKey: mediaAssets.storageKey,
      isSample: mediaAssets.isSample,
      status: mediaAssets.status,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, assetId))
    .limit(1);
  if (row?.provider !== "sample" || !row.isSample || row.status !== "ready") return null;
  if (!row.storageKey || !/^[\w.-]+$/.test(row.storageKey)) return null;
  return row.storageKey;
}
