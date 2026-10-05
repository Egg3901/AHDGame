/**
 * Physical destruction from living-conflict outcomes and the repair obligation
 * it leaves. The destroyed quantity is regional Solow capital
 * (`states.capitalStock`, local-currency millions, the same unit as
 * `states.gdp`).
 */

/** One named region an outcome damages, as a share of its current capital stock. */
export interface CapacityDestructionRegionSpec {
  regionId: string;
  /** Share of the region's capital stock destroyed by one outcome, 0..0.1. */
  capitalShare: number;
}

/** Authored on an outcome that promises physical destruction. */
export interface CapacityDestructionSpec {
  regions: CapacityDestructionRegionSpec[];
  /** Ceiling on unrepaired destruction per region, as a share of its capital stock. */
  maxOutstandingShare: number;
  /** Turns over which the sovereign funds repair in equal installments. */
  repairTurns: number;
  /** Local currency spent per local-currency unit of capital rebuilt (1 = replacement value). */
  repairCostMultiplier: number;
}

/**
 * One region's damage from one resolved outcome. `_id` is deterministic per
 * outcome and region, so a retried resolution inserts nothing twice. Repair is
 * a pure function of `createdTurn` and `repairTurns`: no mutable funding state
 * exists to replay.
 */
export interface ConflictCapacityObligation {
  _id: string;
  conflictKey: string;
  outcomeId: string;
  outcomeLabel: string;
  resolutionId: string;
  regionId: string;
  regionName?: string;
  /** Sovereign when the damage occurred. Repair is paid by the region's sovereign at the time. */
  countryIdAtDestruction: string;
  createdTurn: number;
  capitalStockBefore: number;
  /** Capital removed from the region, local-currency millions. */
  destroyedCapital: number;
  /** Share of the outcome's authored destruction that landed on modeled regions, 0..1. */
  realizedFraction: number;
  repairTurns: number;
  repairCostMultiplier: number;
  /** "repaired" once the metric engine has folded the destruction and the full repair. */
  status: "repairing" | "repaired";
  createdAt: Date;
  updatedAt: Date;
}

/** What the metric engine has already folded into a region's capital stock, per obligation. */
export type ConflictCapacityApplied = Record<string, { destroyed: number; repaired: number }>;

/** Readout stored on the resolved response so players and diagnostics see what was hit. */
export interface CapacityDestructionSummary {
  regions: Array<{
    regionId: string;
    regionName?: string;
    countryId: string;
    destroyedCapital: number;
    obligationId: string;
  }>;
  skipped: Array<{ regionId: string; reason: string }>;
  /** Share of the authored destruction that landed on modeled regions, 0..1. */
  realizedFraction: number;
}
