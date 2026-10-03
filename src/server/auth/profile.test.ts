import { describe, expect, it, vi } from "vitest";

const queried = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/server/db", () => ({
  db: () => {
    queried.count += 1;
    throw new Error("the database must not be queried for a non-student");
  },
}));

import { shouldPromptParentLink } from "./profile";

describe("shouldPromptParentLink", () => {
  it.each(["parent", "teacher", "admin", "reviewer"] as const)(
    "does not query for a %s",
    async (role) => {
      await expect(shouldPromptParentLink({ id: "u1", role })).resolves.toBe(false);
      expect(queried.count).toBe(0);
    },
  );
});
