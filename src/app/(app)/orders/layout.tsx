import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/server/auth/session";

export default async function OrdersLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // No session: render no frame. Every page calls requirePageUser/requirePageRole first, which
  // redirects to /sign-in with that page as `next`; a layout redirect would lose it.
  if (!user) return children;
  return <AppShell user={user}>{children}</AppShell>;
}
