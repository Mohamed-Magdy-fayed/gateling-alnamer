import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ adopted: [] as string[], valid: true }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/server/auth/pending-reset", () => ({
  adoptPendingReset: async (token: string) => {
    if (!h.valid) return false;
    h.adopted.push(token);
    return true;
  },
}));

const { GET } = await import("./route");
const call = (query: string) =>
  GET({ nextUrl: new URL(`https://alnamer.example/reset-password/continue?${query}`) } as never);

beforeEach(() => {
  h.adopted.length = 0;
  h.valid = true;
});

describe("GET /reset-password/continue", () => {
  it("adopts a valid token and opens the code form", async () => {
    await expect(call("t=signed.token")).rejects.toThrow("redirect:/reset-password");
    expect(h.adopted).toEqual(["signed.token"]);
  });

  it("sends a missing, oversized or bad token back to forgot-password", async () => {
    await expect(call("")).rejects.toThrow("redirect:/forgot-password");
    await expect(call(`t=${"x".repeat(1025)}`)).rejects.toThrow("redirect:/forgot-password");
    h.valid = false;
    await expect(call("t=forged")).rejects.toThrow("redirect:/forgot-password");
    expect(h.adopted).toEqual([]);
  });
});
