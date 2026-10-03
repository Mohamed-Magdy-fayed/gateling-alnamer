"use client";

import { createContext, type ReactNode, useContext } from "react";

export type ErrorTexts = { message: string; retry: string };

const ErrorTextsContext = createContext<ErrorTexts | null>(null);

/**
 * Hands the translated retry copy to `error.tsx`, which is a client component that cannot read the
 * dictionary itself. Provided by the `(app)` layout, which sits above the error boundary.
 */
export function ErrorTextsProvider({
  texts,
  children,
}: {
  texts: ErrorTexts;
  children: ReactNode;
}) {
  return <ErrorTextsContext.Provider value={texts}>{children}</ErrorTextsContext.Provider>;
}

export function useErrorTexts(): ErrorTexts | null {
  return useContext(ErrorTextsContext);
}
