import type { ReactNode } from "react";
import { assertDevRoute } from "@/server/dev-guard";

export default function DevLayout({ children }: { children: ReactNode }) {
  assertDevRoute();
  return children;
}
