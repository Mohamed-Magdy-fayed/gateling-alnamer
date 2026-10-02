import "server-only";
import { notFound } from "next/navigation";
import { serverEnv } from "@/server/env";

/** Dev pages (component gallery, fixtures) exist only in the demo. */
export function devRoutesEnabled(env: { readonly APP_MODE: "demo" | "live" }): boolean {
  return env.APP_MODE === "demo";
}

/** Call at the top of any `/dev` route handler or layout; renders the 404 page when disabled. */
export function assertDevRoute(): void {
  if (!devRoutesEnabled(serverEnv())) notFound();
}
