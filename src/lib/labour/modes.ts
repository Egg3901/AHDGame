/**
 * Client-safe labour-system mode metadata — the single source of truth for the
 * mode enum, its order, and the tier comparisons. `featureFlag.ts` (server-only:
 * imports `@/lib/mongodb`) re-exports from here.
 *
 * Split out to mirror `@/lib/market/modes`. The reason is the same one that
 * module documents: anything that needs the enum *before* Mongo/env are set up
 * — the sim harness's argv validation, the admin Zod schema, the client — must
 * be able to import it without dragging in a Mongo connection. Importing
 * `featureFlag.ts` eagerly from `scripts/sim/runWorld.ts` would race the
 * env-var setup it performs before bootstrap.
 */
export type LabourSystemMode = "off" | "wages" | "macro" | "unions" | "full";

/** Tiers in ascending order; index = rank used for `labourAtLeast` comparisons. */
export const LABOUR_MODE_ORDER: readonly LabourSystemMode[] = [
  "off",
  "wages",
  "macro",
  "unions",
  "full",
] as const;

export function isLabourSystemMode(value: unknown): value is LabourSystemMode {
  return typeof value === "string" && (LABOUR_MODE_ORDER as readonly string[]).includes(value);
}

/** Numeric rank of a mode (off=0 … full=4). */
export function labourModeRank(mode: LabourSystemMode): number {
  return LABOUR_MODE_ORDER.indexOf(mode);
}

/** True when `mode` is at least the given `tier` (inclusive). */
export function labourAtLeast(mode: LabourSystemMode, tier: LabourSystemMode): boolean {
  return labourModeRank(mode) >= labourModeRank(tier);
}
