/**
 * Reset-era system versions. Metrics, legislation, and Cabinet each retain
 * their live v1 behavior until an administrator selects an available v2 path.
 * resolveResetSystemVersion treats missing, unknown, and unreleased values as v1.
 */

export const RESET_SYSTEMS = ["metrics", "legislation", "cabinet"] as const;

export type ResetSystem = (typeof RESET_SYSTEMS)[number];
export type ResetSystemVersion = "v1" | "v2";

export const RESET_SYSTEM_VERSION_FIELDS = {
  metrics: "metricsSystemVersion",
  legislation: "legislationSystemVersion",
  cabinet: "cabinetSystemVersion",
} as const satisfies Record<ResetSystem, string>;

/** Read persisted state without trusting missing or malformed values. */
export function resolveResetSystemVersion(value: unknown, v2Ready: boolean): ResetSystemVersion {
  return v2Ready && value === "v2" ? "v2" : "v1";
}

export function resetSystemVersionsFrom(
  state: Partial<Record<(typeof RESET_SYSTEM_VERSION_FIELDS)[ResetSystem], unknown>> | null,
  v2Ready: Record<ResetSystem, boolean>
): Record<ResetSystem, ResetSystemVersion> {
  return {
    metrics: resolveResetSystemVersion(state?.metricsSystemVersion, v2Ready.metrics),
    legislation: resolveResetSystemVersion(state?.legislationSystemVersion, v2Ready.legislation),
    cabinet: resolveResetSystemVersion(state?.cabinetSystemVersion, v2Ready.cabinet),
  };
}
