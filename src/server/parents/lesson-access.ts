import type { UserRole } from "@/server/db/schema";

/** Why a role may not open a lesson, or null. T1's `getLessonAccess` takes this over. */
export function lessonDenial(role: UserRole): "cannotPlay" | null {
  return role === "parent" ? "cannotPlay" : null;
}
