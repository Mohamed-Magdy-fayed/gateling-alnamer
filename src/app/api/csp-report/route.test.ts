import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/server/auth/abuse", () => ({
  guardCspReport: async () => (h.allowed ? { ok: true } : { blocked: "locked" }),
}));

const { POST } = await import("./route");
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

const report = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://alnamer.example/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const legacy = {
  "csp-report": {
    "document-uri": "https://alnamer.example/sign-in?next=%2Fsecret",
    "effective-directive": "script-src-elem",
    "blocked-uri": "inline",
  },
};

beforeEach(() => {
  h.allowed = true;
});
afterEach(() => warn.mockClear());

describe("POST /api/csp-report", () => {
  it("logs one compact line without the query and answers 204", async () => {
    const res = await report(legacy);
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("[csp] script-src-elem blocked=inline page=/sign-in");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("drops rate-limited, oversized and malformed reports silently", async () => {
    h.allowed = false;
    expect((await report(legacy)).status).toBe(204);
    h.allowed = true;
    expect((await report("x".repeat(9000))).status).toBe(204);
    expect((await report(legacy, { "content-length": "100000" })).status).toBe(204);
    expect((await report("{not json")).status).toBe(204);
    // A chunked upload (no content-length) stops being read past the limit.
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4096).fill(32));
      },
    });
    const chunked = await POST(
      new Request("https://alnamer.example/api/csp-report", {
        method: "POST",
        body: big,
        duplex: "half",
      } as RequestInit),
    );
    expect(chunked.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
