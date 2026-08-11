/**
 * Pure UK SCO/WAL/NIR Independence/Reunification Desire drift surface —
 * driver types and the per-turn snapshot compute shared by the turn engine
 * and the Devolution tab's driver-breakdown preview, so both stay in
 * lockstep with the constants. No DB I/O. The DB-reading/writing side lives
 * in `@/lib/turn/independenceDesireDrift`, which re-exports everything here.
 */
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import {
  regionalApprovalDrift,
  DEVOLUTION_POLICY_DRIFT,
  inflationDrift,
  meanReversionDrift,
  nationalApprovalDrift,
} from "@/lib/constants/devolution";

export interface IndependenceDesireDriftPerRegion {
  stateId: string;
  policy: DevolutionPolicy;
  previous: number;
  next: number;
  delta: number;
  drivers: {
    policy: number;
    regionalApproval: number;
    nationalApproval: number;
    inflation: number;
    meanReversion: number;
  };
  inputs: {
    regionalApproval: number;
    nationalApproval: number;
    inflationPercent: number;
  };
}

export interface IndependenceDesireDriftResult {
  regionsProcessed: number;
  perRegion: IndependenceDesireDriftPerRegion[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Round to 2 decimals — keeps stored values readable without losing drift resolution. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Pure compute helper — shared by the turn engine and the Devolution tab's
 * driver-breakdown preview, so both stay in lockstep with the constants.
 * No DB I/O.
 */
export function computeIndependenceDesireDriftSnapshot(args: {
  previous: number;
  policy: DevolutionPolicy;
  regionalApproval: number;
  nationalApproval: number;
  inflationPercent: number;
}): {
  drivers: IndependenceDesireDriftPerRegion["drivers"];
  delta: number;
  next: number;
} {
  const { previous, policy, regionalApproval, nationalApproval, inflationPercent } = args;
  const drivers = {
    policy: DEVOLUTION_POLICY_DRIFT[policy],
    regionalApproval: regionalApprovalDrift(regionalApproval, policy),
    nationalApproval: nationalApprovalDrift(nationalApproval),
    inflation: inflationDrift(inflationPercent),
    meanReversion: meanReversionDrift(previous),
  };
  const delta =
    drivers.policy +
    drivers.regionalApproval +
    drivers.nationalApproval +
    drivers.inflation +
    drivers.meanReversion;
  const next = round2(clamp(previous + delta, 0, 100));
  return { drivers, delta: round2(delta), next };
}
