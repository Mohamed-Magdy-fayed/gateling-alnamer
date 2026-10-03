"use client";

import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Dictionary } from "@/i18n/ar";
import { useTRPC } from "@/lib/trpc/client";
import { Alert, Button } from "@/ui";

type DashboardText = Dictionary["dashboard"];

type Props = {
  lessonId: string;
  /** Shown on the moving watermark: display name and public number. */
  watermarkName: string;
  watermarkNumber: string;
  /** The dashboard texts; the player reads its own `player` group. */
  t: DashboardText;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "no_video" }
  | { kind: "error" };

/** Fresh URLs fetched after a playback error (an expired URL mid-lesson) before giving up. */
const MAX_REFRESHES = 3;

/**
 * The lesson video. It asks the server for a short-lived playback URL (issued only after the access
 * decision), and when the URL expires mid-lesson it fetches a new one and resumes where the student
 * was. The watermark (name and public number) walks over the frame; D2 hardens it.
 */
export function VideoPlayer({ lessonId, watermarkName, watermarkNumber, t }: Props) {
  const trpc = useTRPC();
  const playback = useMutation(trpc.video.playback.mutationOptions());
  const [state, setState] = useState<State>({ kind: "loading" });
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const refreshes = useRef(0);
  const { mutateAsync } = playback;

  const load = useCallback(async () => {
    try {
      const result = await mutateAsync({ lessonId });
      if (result.ok) {
        setState({ kind: "ready", url: result.url });
        return;
      }
      if (result.reason === "no_video") {
        setState({ kind: "no_video" });
        return;
      }
      // A limit, or access that changed since the page rendered: "Try again" re-asks, and a reload
      // of the page shows the access notice.
      setState({ kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }, [lessonId, mutateAsync]);

  useEffect(() => {
    void load();
  }, [load]);

  function onMediaError() {
    if (refreshes.current >= MAX_REFRESHES) {
      setState({ kind: "error" });
      return;
    }
    refreshes.current += 1;
    resumeAt.current = videoRef.current?.currentTime ?? 0;
    void load();
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (video && resumeAt.current > 0) video.currentTime = resumeAt.current;
  }

  function retry() {
    refreshes.current = 0;
    setState({ kind: "loading" });
    void load();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Media stays LTR by convention (DESIGN.md section 7). */}
      <div
        dir="ltr"
        className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] bg-media shadow-e3"
      >
        {state.kind === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
        {state.kind === "ready" ? (
          // biome-ignore lint/a11y/useMediaCaption: sample lessons have no captions yet (D2 adds tracks).
          <video
            ref={videoRef}
            key={state.url}
            src={state.url}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onContextMenu={(event) => event.preventDefault()}
            onError={onMediaError}
            onLoadedMetadata={onLoadedMetadata}
            aria-label={t.player.videoLabel}
            className="absolute inset-0 size-full"
          />
        ) : null}
        {state.kind === "no_video" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-media-fg">
            <span dir="auto">{t.player.noVideo}</span>
          </div>
        ) : null}
        <div aria-hidden className="pointer-events-none absolute start-[10%] top-[8%] select-none">
          <div
            data-testid="watermark"
            className="watermark-walk rounded px-2 py-1 text-sm font-medium text-media-fg/55"
          >
            <bdi>{watermarkName}</bdi> · {watermarkNumber}
          </div>
        </div>
      </div>
      {state.kind === "error" ? (
        <Alert tone="danger">
          <span className="flex flex-wrap items-center gap-3">
            {t.player.loadError}
            <Button variant="secondary" size="sm" className="min-h-11" onClick={retry}>
              {t.player.retry}
            </Button>
          </span>
        </Alert>
      ) : null}
    </div>
  );
}
