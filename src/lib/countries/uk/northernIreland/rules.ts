/**
 * Northern Ireland's peace settlement controls devolved institutions and the
 * standing cost of political violence. Effects follow consent and ratification;
 * they never grant either community's consent themselves.
 */
import type { LivingConflictState } from "@/lib/livingConflict/types";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { UKDevolutionState } from "../devolution/rules";

export const NI_SECURITY_SPENDING_KEY = "northernIrelandSecurity";
export type NorthernIrelandPosture = "unsettled" | "power_sharing" | "suspended";
export type NorthernIrelandSignal = Pick<
  LivingConflictState,
  "hasOpened" | "status" | "phaseLevel" | "tracks"
>;

const track = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value ?? 0)) : 0;

export function northernIrelandPosture(state: NorthernIrelandSignal): NorthernIrelandPosture {
  return state.phaseLevel === 6 &&
    state.status === "settled" &&
    (state.tracks?.ratificationAuthorization ?? 0) >= 2 &&
    (state.tracks?.referendumRatification ?? 0) >= 1
    ? "power_sharing"
    : state.phaseLevel === 7
      ? "suspended"
      : "unsettled";
}

/** A maximum two percent of regional annual GDP, scaled by current violence. */
export function northernIrelandSecurityCost(
  state: NorthernIrelandSignal | null,
  regionalGdp: number
): number {
  if (
    !state?.hasOpened ||
    state.status === "closed" ||
    !Number.isFinite(regionalGdp) ||
    regionalGdp <= 0
  )
    return 0;
  return Math.round((regionalGdp * 0.02 * track(state.tracks?.violence)) / 100);
}

/** Bounded standing offsets, removed when the conflict closes; not cumulative shocks. */
export function northernIrelandPoliticalEffects(
  state: NorthernIrelandSignal | null
): Partial<Record<PoliticalMetricId, number>> {
  if (!state?.hasOpened || state.status === "closed") return {};
  const violence = track(state.tracks?.violence) / 100;
  const legitimacy = track(state.tracks?.legitimacy) / 100;
  const posture = northernIrelandPosture(state);
  return {
    "order.safety": -5 * violence,
    "governance.localAutonomy": posture === "power_sharing" ? 4 : posture === "suspended" ? -4 : -2,
    "governance.participation": 4 * (legitimacy - 0.5),
  };
}

export function northernIrelandRegion(countryId: string, regionId: string): boolean {
  // eslint-disable-next-line local/no-country-literals -- this country-owned rule identifies the bilateral Northern Ireland settlement
  return countryId === "UK" && regionId === "NIR";
}

/** Preserve other regions and election anchors; restoration starts a new valid cycle. */
export function reconcileNorthernIrelandInstitution(
  current: UKDevolutionState,
  conflict: NorthernIrelandSignal,
  turn: number,
  latestExecutiveCycle: number,
  electionWindow: number,
  latestAssemblyCycle: number,
  assemblyWindow: number
): UKDevolutionState {
  if (!conflict.hasOpened || conflict.status === "closed") return current;
  const posture = northernIrelandPosture(conflict);
  if (current.northernIrelandPeace?.posture === posture) return current;
  const next = structuredClone(current);
  const active = posture === "power_sharing";
  const prior = current.regions.NIR;
  next.regions.NIR =
    active && !prior.active
      ? {
          active: true,
          firstCycle: latestExecutiveCycle + 1,
          firstElectionEndTurn: turn + electionWindow,
        }
      : { ...prior, active };
  next.northernIrelandPeace = {
    posture,
    changedTurn: turn,
    ...(active
      ? {
          assemblyFirstCycle: latestAssemblyCycle + 1,
          assemblyFirstElectionEndTurn: turn + assemblyWindow,
        }
      : {}),
  };
  return next;
}
