"use client";

import { type RefObject, useRef } from "react";

/**
 * Where focus goes once a confirm dialog has closed after a mutation. Radix would return it to the
 * trigger, which a successful removal has just deleted (focus falls to body), so the row sets the
 * target (the section heading on success, the message on failure) and the dialog hands focus there.
 * A plain cancel sets no target and keeps Radix's return to the trigger.
 */
export function useOutcomeFocus(): {
  target: RefObject<string | null>;
  onCloseAutoFocus: (event: Event) => void;
} {
  const target = useRef<string | null>(null);
  return {
    target,
    onCloseAutoFocus(event) {
      const id = target.current;
      if (!id) return;
      target.current = null;
      event.preventDefault();
      const element = document.getElementById(id);
      if (element) element.focus();
      else document.getElementById("main")?.focus();
    },
  };
}
