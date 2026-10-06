/**
 * Reset-era system versions. Admin selections target the next world reset;
 * they never convert a running v1 world in place.
 * resolveResetSystemVersion treats missing, unknown, and unreleased values as v1.
 */

export const RESET_SYSTEMS = ["metrics", "legislation", "cabinet"] as const;

export type ResetSystem = (typeof RESET_SYSTEMS)[number];
export type ResetSystemVersion = "v1" | "v2";
/** Countries with reviewed v2 boards at the 1991 reset. */
export const RESET_V2_OPENING_COUNTRIES = ["US", "UK", "JP", "IE"] as const;

/** Countries whose reviewed v2 boards are created only when independence occurs. */
export const RESET_V2_SUCCESSOR_COUNTRIES = ["SCO", "WAL"] as const;

export const RESET_V2_COUNTRIES = [
  ...RESET_V2_OPENING_COUNTRIES,
  ...RESET_V2_SUCCESSOR_COUNTRIES,
] as const;
export type ResetV2Country = (typeof RESET_V2_COUNTRIES)[number];

export function isResetV2Country(countryId: string): countryId is ResetV2Country {
  return (RESET_V2_COUNTRIES as readonly string[]).includes(countryId);
}

/** Bump a revision when the verified opening representation changes incompatibly. */
export const RESET_V2_SEED_REVISION: Readonly<Record<ResetSystem, number>> = {
  metrics: 3,
  legislation: 6,
  // Opening working capital changes values on the next reset but does not
  // change the persisted Cabinet account shape. Keep revision 8 so running v2
  // worlds do not lose their department accounts when this code is deployed.
  cabinet: 8,
};

/** Written only after a fresh world's v2 opening seed and validation complete. */
export interface ResetSystemSeedReceipt {
  worldId: string;
  revision: number;
  sourceTurn: number;
  completedAt: string;
  verificationHash: string;
  /** Countries whose boards were verified under this receipt. Missing means the original trio. */
  countries?: string[];
}

const LEGACY_V2_COUNTRIES = ["US", "UK", "JP"] as const;

/** Preserve the original verified trio when a live-world promotion adds coverage. */
export function mergeResetReceiptCountries(
  existing: readonly string[] | undefined,
  additions: readonly string[]
): string[] {
  return [...new Set([...LEGACY_V2_COUNTRIES, ...(existing ?? []), ...additions])].sort();
}

export interface ResetVersionState {
  metricsSystemVersion?: unknown;
  legislationSystemVersion?: unknown;
  cabinetSystemVersion?: unknown;
  resetWorldId?: unknown;
  resetVersionSeeds?: Partial<Record<ResetSystem, ResetSystemSeedReceipt>>;
  resetSystemSelections?: Partial<Record<ResetSystem, ResetSystemVersion>>;
}

export const RESET_SYSTEM_VERSION_FIELDS = {
  metrics: "metricsSystemVersion",
  legislation: "legislationSystemVersion",
  cabinet: "cabinetSystemVersion",
} as const satisfies Record<ResetSystem, string>;

/** Read persisted state without trusting missing or malformed values. */
export function resolveResetSystemVersion(value: unknown, v2Ready: boolean): ResetSystemVersion {
  return v2Ready && value === "v2" ? "v2" : "v1";
}

export function resetSeedComplete(state: ResetVersionState | null, system: ResetSystem): boolean {
  const receipt = state?.resetVersionSeeds?.[system];
  return (
    typeof state?.resetWorldId === "string" &&
    state.resetWorldId.length > 0 &&
    receipt?.worldId === state.resetWorldId &&
    receipt.revision === RESET_V2_SEED_REVISION[system] &&
    Number.isSafeInteger(receipt.sourceTurn) &&
    receipt.sourceTurn > 0 &&
    typeof receipt.completedAt === "string" &&
    receipt.completedAt.length > 0 &&
    typeof receipt.verificationHash === "string" &&
    receipt.verificationHash.length > 0
  );
}

export function resetSystemVersionsFrom(
  state: ResetVersionState | null,
  v2Ready: Record<ResetSystem, boolean>
): Record<ResetSystem, ResetSystemVersion> {
  const metrics = resolveResetSystemVersion(
    state?.metricsSystemVersion,
    v2Ready.metrics && resetSeedComplete(state, "metrics")
  );
  return {
    metrics,
    legislation: resolveResetSystemVersion(
      state?.legislationSystemVersion,
      v2Ready.legislation && metrics === "v2" && resetSeedComplete(state, "legislation")
    ),
    cabinet: resolveResetSystemVersion(
      state?.cabinetSystemVersion,
      v2Ready.cabinet && metrics === "v2" && resetSeedComplete(state, "cabinet")
    ),
  };
}

/** Global selectors do not route countries without a reviewed v2 catalog into v2. */
export function resetSystemVersionsForCountry(
  state: ResetVersionState | null,
  v2Ready: Record<ResetSystem, boolean>,
  countryId: string
): Record<ResetSystem, ResetSystemVersion> {
  if (!isResetV2Country(countryId)) {
    return { metrics: "v1", legislation: "v1", cabinet: "v1" };
  }
  const versions = resetSystemVersionsFrom(state, v2Ready);
  if ((["US", "UK", "JP"] as const).includes(countryId as "US" | "UK" | "JP")) {
    return versions;
  }
  const included = (system: ResetSystem) =>
    state?.resetVersionSeeds?.[system]?.countries?.includes(countryId) === true;
  return {
    metrics: versions.metrics === "v2" && included("metrics") ? "v2" : "v1",
    legislation:
      versions.legislation === "v2" && included("metrics") && included("legislation") ? "v2" : "v1",
    cabinet: versions.cabinet === "v2" && included("metrics") && included("cabinet") ? "v2" : "v1",
  };
}

/** Admin choices target the next reset, not a live-world conversion. */
function rawResetSystemSelectionsFrom(
  state: ResetVersionState | null
): Record<ResetSystem, ResetSystemVersion> {
  const metrics = state?.resetSystemSelections?.metrics ?? state?.metricsSystemVersion;
  const legislation = state?.resetSystemSelections?.legislation ?? state?.legislationSystemVersion;
  const cabinet = state?.resetSystemSelections?.cabinet ?? state?.cabinetSystemVersion;
  return {
    metrics: metrics === "v2" ? "v2" : "v1",
    legislation: legislation === "v2" ? "v2" : "v1",
    cabinet: cabinet === "v2" ? "v2" : "v1",
  };
}

export function resetSystemSelectionsFrom(
  state: ResetVersionState | null
): Record<ResetSystem, ResetSystemVersion> {
  const raw = rawResetSystemSelectionsFrom(state);
  return {
    metrics: raw.metrics,
    legislation: raw.metrics === "v2" ? raw.legislation : "v1",
    cabinet: raw.metrics === "v2" ? raw.cabinet : "v1",
  };
}

/** A v2 reset can only use the authored opening era and complete runtime paths. */
export function resetSelectionPreflight(
  state: ResetVersionState | null,
  preset: string,
  atPresetAnchor: boolean,
  v2Ready: Record<ResetSystem, boolean>
): { allowed: true } | { allowed: false; reason: string } {
  const raw = rawResetSystemSelectionsFrom(state);
  if (raw.metrics !== "v2" && (raw.legislation === "v2" || raw.cabinet === "v2")) {
    return { allowed: false, reason: "Reset v2 legislation and Cabinet require metrics v2" };
  }
  const selected = resetSystemSelectionsFrom(state);
  const requested = RESET_SYSTEMS.filter((system) => selected[system] === "v2");
  if (requested.length === 0) return { allowed: true };
  if (preset !== "1991-default" || !atPresetAnchor) {
    return { allowed: false, reason: "Reset v2 requires the 1991-default opening date" };
  }
  const unavailable = requested.filter((system) => !v2Ready[system]);
  if (unavailable.length > 0) {
    return { allowed: false, reason: `Reset v2 systems are not ready: ${unavailable.join(", ")}` };
  }
  return { allowed: true };
}

export function resetVersionSelectionEligibility(
  state: ResetVersionState | null,
  system: ResetSystem,
  next: ResetSystemVersion,
  v2Ready: Record<ResetSystem, boolean>
):
  | { allowed: true }
  | { allowed: false; reason: "unavailable" | "metrics_required" | "dependent_v2" } {
  if (next === "v2" && !v2Ready[system]) return { allowed: false, reason: "unavailable" };
  const selected = resetSystemSelectionsFrom(state);
  const raw = rawResetSystemSelectionsFrom(state);
  if (next === "v2" && system !== "metrics" && selected.metrics !== "v2") {
    return { allowed: false, reason: "metrics_required" };
  }
  if (next === "v1" && system === "metrics" && (raw.legislation === "v2" || raw.cabinet === "v2")) {
    return { allowed: false, reason: "dependent_v2" };
  }
  return { allowed: true };
}
