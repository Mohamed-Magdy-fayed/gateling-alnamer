"use client";

import { useEffect } from "react";
import { Alert } from "@/ui";

/**
 * The over-limit warning from sign-in. It stays visible for this render, then the one-shot
 * `notice` param leaves the URL (history only, no refetch) so a reload does not repeat it.
 */
export function SoftWarning({ message }: { message: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("notice")) return;
    url.searchParams.delete("notice");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return <Alert tone="warning">{message}</Alert>;
}
