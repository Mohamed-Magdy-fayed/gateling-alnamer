export const SELF_REMOVAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type DeviceLimitMode = "strict" | "soft";
export type DeviceDecision = "known" | "register" | "registerOver" | "block";

/** Pure: whether `deviceKey` may sign in given the student's active devices, the limit and the mode. */
export function decide(input: {
  activeDevices: readonly { deviceKey: string }[];
  deviceKey: string;
  limit: number;
  mode: DeviceLimitMode;
}): DeviceDecision {
  if (input.activeDevices.some((d) => d.deviceKey === input.deviceKey)) return "known";
  if (input.activeDevices.length < input.limit) return "register";
  return input.mode === "soft" ? "registerOver" : "block";
}

/** When the next self removal opens: last self removal + 7 days, or null when allowed now. Admin removals do not count. */
export function nextSelfRemovalAt(
  removals: readonly { kind: "self" | "admin"; createdAt: Date }[],
  now: Date,
): Date | null {
  let last: number | null = null;
  for (const removal of removals) {
    if (removal.kind !== "self") continue;
    const at = removal.createdAt.getTime();
    if (last === null || at > last) last = at;
  }
  if (last === null) return null;
  const next = last + SELF_REMOVAL_INTERVAL_MS;
  return next > now.getTime() ? new Date(next) : null;
}
