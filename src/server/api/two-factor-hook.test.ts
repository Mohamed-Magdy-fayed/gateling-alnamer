import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));

import { setTwoFactorEnforcedForTests } from "./trpc";

afterEach(() => {
  vi.unstubAllEnvs();
  setTwoFactorEnforcedForTests(null);
});

describe("setTwoFactorEnforcedForTests", () => {
  it("works under NODE_ENV=test", () => {
    expect(() => setTwoFactorEnforcedForTests(() => true)).not.toThrow();
  });

  it.each(["production", "development"])("throws under NODE_ENV=%s", (env) => {
    vi.stubEnv("NODE_ENV", env);
    expect(() => setTwoFactorEnforcedForTests(() => true)).toThrow(/test/i);
    expect(() => setTwoFactorEnforcedForTests(null)).toThrow(/test/i);
  });
});
