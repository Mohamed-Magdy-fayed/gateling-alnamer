"use client";

import { useEffect } from "react";

/**
 * A buy button stays in its pending state while the browser leaves for the payment page. When the
 * user comes back with the Back button, the browser may restore the page from its back/forward
 * cache with that state intact; `reset` puts the button back so it can be used again.
 */
export function useResetOnRestore(reset: () => void): void {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [reset]);
}
