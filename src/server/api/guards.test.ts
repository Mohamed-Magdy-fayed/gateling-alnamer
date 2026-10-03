import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ BASE_URL: "https://alnamer.example" }),
}));

import { PUBLIC_PROCEDURES } from "./public-procedures";
import { appRouter } from "./root";
import { createCallerFactory, type GuardMeta, publicProcedure, router } from "./trpc";

const RECIPE = "docs-public/recipes/trpc-procedure.md";
const FIX =
  "Build it from protectedProcedure, roleProcedure(...roles), staffProcedure(...roles) or " +
  `superAdminProcedure in src/server/api/trpc.ts (see ${RECIPE}).`;

type Entry = { path: string; meta: Partial<GuardMeta> | undefined };

function enumerate(): Entry[] {
  return Object.entries(appRouter._def.procedures as unknown as Record<string, unknown>).map(
    ([path, proc]) => ({
      path,
      meta: (proc as unknown as { _def: { meta?: Partial<GuardMeta> } })._def.meta,
    }),
  );
}

function violations(): string[] {
  const out: string[] = [];
  for (const { path, meta } of enumerate()) {
    const guard = meta?.guard;
    if (!guard) {
      out.push(`${path}: no guard meta. ${FIX}`);
      continue;
    }
    if (guard === "public" && !(path in PUBLIC_PROCEDURES)) {
      out.push(
        `${path}: public but not in PUBLIC_PROCEDURES. Add it with a one-line reason to src/server/api/public-procedures.ts, or ${FIX}`,
      );
    }
    if ((guard === "staff" || guard === "superAdmin") && meta?.twoFactor !== true) {
      out.push(
        `${path}: ${guard} procedure without the two-factor check. Use staffProcedure(...) / superAdminProcedure from src/server/api/trpc.ts (see ${RECIPE}).`,
      );
    }
    if (path.startsWith("admin.") && guard !== "staff" && guard !== "superAdmin") {
      out.push(
        `${path}: admin.* must be staffProcedure("admin") or superAdminProcedure (see ${RECIPE}).`,
      );
    }
  }
  return out;
}

describe("procedure guard enumeration", () => {
  it("finds the procedures of every router", () => {
    const paths = enumerate().map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["health.ping", "admin.devices.reset"]));
  });

  it("every procedure declares a guard, and public ones are allow-listed", () => {
    expect(violations(), violations().join("\n")).toEqual([]);
  });

  it("the allow-list holds no stale or reasonless entries", () => {
    const publicPaths = new Set(
      enumerate()
        .filter((e) => e.meta?.guard === "public")
        .map((e) => e.path),
    );
    for (const [path, reason] of Object.entries(PUBLIC_PROCEDURES)) {
      expect(publicPaths.has(path), `${path} is allow-listed but is not a public procedure`).toBe(
        true,
      );
      expect(reason.trim().length, `${path} needs a reason`).toBeGreaterThan(5);
    }
  });
});

/** Minimal valid input for procedures whose zod schema would otherwise answer BAD_REQUEST. */
const INPUT_FIXTURES: Readonly<Record<string, unknown>> = {};

const HEADERS = new Headers({ origin: "https://alnamer.example", host: "alnamer.example" });

type AnyRouter = Parameters<typeof createCallerFactory>[0];

/** Calls every non-public procedure anonymously; returns the ones that did not answer UNAUTHORIZED. */
async function anonymousLeaks(target: AnyRouter, allowed: ReadonlySet<string>): Promise<string[]> {
  const caller = createCallerFactory(target)({ user: null, headers: HEADERS }) as unknown as Record<
    string,
    unknown
  >;
  const procedures = (target._def as unknown as { procedures: Record<string, unknown> }).procedures;
  const leaks: string[] = [];
  for (const path of Object.keys(procedures)) {
    if (allowed.has(path)) continue;
    const call = path
      .split(".")
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller);
    try {
      await (call as (input?: unknown) => Promise<unknown>)(INPUT_FIXTURES[path]);
      leaks.push(`${path}: answered an anonymous caller.`);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "UNAUTHORIZED") continue;
      leaks.push(
        code === "BAD_REQUEST"
          ? `${path}: input parsing failed before auth ran; add a minimal valid input to INPUT_FIXTURES["${path}"] (or run auth before .input()).`
          : `${path}: expected UNAUTHORIZED for an anonymous caller, got ${code ?? String(error)}.`,
      );
    }
  }
  return leaks;
}

describe("behavioural guard", () => {
  it("every non-public procedure answers an anonymous caller UNAUTHORIZED", async () => {
    const leaks = await anonymousLeaks(appRouter, new Set(Object.keys(PUBLIC_PROCEDURES)));
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  it("catches a procedure that declares a guard in meta but has no guard middleware", async () => {
    const fake = router({
      sneaky: publicProcedure.meta({ guard: "protected" }).query(() => "secret"),
    });
    expect(await anonymousLeaks(fake, new Set())).toEqual([
      "sneaky: answered an anonymous caller.",
    ]);
  });

  it("raw publicProcedure is only used by allow-listed procedures", () => {
    const publics = enumerate()
      .filter((e) => e.meta?.guard === "public")
      .map((e) => e.path)
      .sort();
    expect(publics).toEqual(Object.keys(PUBLIC_PROCEDURES).sort());
  });
});
