/**
 * Pure rules for conflict capacity destruction and funded repair.
 *
 * An outcome that promises physical destruction removes a bounded share of the
 * named regions' capital stock once, keyed by resolution and region. The
 * region's sovereign then pays for repair in equal installments through its
 * national budget, and the rebuilt capital returns to the stock on the same
 * schedule. Repair is a pure function of the obligation and the turn, so the
 * budget line and the stock cannot drift apart or be charged twice on replay.
 * Output follows the stock through the production function: a region's GDP
 * level scales by (K'/K)^alpha when the stock moves, so loss and repair are
 * symmetric and the campaign's infrastructure score stays a pressure signal
 * rather than a second charge.
 */
import { CAPITAL_SHARE } from "@/lib/metricEngine/potentialGrowth";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type {
  CapacityDestructionSpec,
  CapacityDestructionSummary,
  ConflictCapacityApplied,
} from "@/lib/db/types/conflictCapacity";

/** Local currency units per local-currency million of capital. */
export const CAPITAL_UNIT_LOCAL = 1_000_000;
export const MAX_REGION_CAPITAL_SHARE = 0.1;
export const MAX_OUTSTANDING_SHARE = 0.5;
export const MAX_REPAIR_TURNS = 480;
/** Capital and repair quantities are stored to a thousandth of a million. */
const PRECISION = 1000;

const round = (value: number) => Math.round(value * PRECISION) / PRECISION;
const finite = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Gameplay assumptions, not historical damage estimates: each resolved
 * escalation destroys half a percent of the capital stock of the two regions
 * the fighting centred on, repaired over two game years at replacement cost.
 */
export const YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION: CapacityDestructionSpec = {
  regions: [
    { regionId: "YU_CRO", capitalShare: 0.005 },
    { regionId: "YU_BIH", capitalShare: 0.005 },
  ],
  maxOutstandingShare: 0.2,
  repairTurns: 96,
  repairCostMultiplier: 1,
};

export function validateCapacityDestructionSpec(spec: CapacityDestructionSpec): void {
  const seen = new Set<string>();
  if (spec.regions.length === 0) throw new Error("Capacity destruction names no regions");
  for (const region of spec.regions) {
    if (!region.regionId || seen.has(region.regionId))
      throw new Error(`Capacity destruction region is missing or repeated: ${region.regionId}`);
    seen.add(region.regionId);
    if (
      !Number.isFinite(region.capitalShare) ||
      region.capitalShare <= 0 ||
      region.capitalShare > MAX_REGION_CAPITAL_SHARE
    )
      throw new Error(`Capacity destruction share out of bounds for ${region.regionId}`);
  }
  if (
    !Number.isFinite(spec.maxOutstandingShare) ||
    spec.maxOutstandingShare <= 0 ||
    spec.maxOutstandingShare > MAX_OUTSTANDING_SHARE
  )
    throw new Error("Capacity destruction outstanding ceiling out of bounds");
  if (
    !Number.isSafeInteger(spec.repairTurns) ||
    spec.repairTurns < 1 ||
    spec.repairTurns > MAX_REPAIR_TURNS
  )
    throw new Error("Capacity repair duration out of bounds");
  if (
    !Number.isFinite(spec.repairCostMultiplier) ||
    spec.repairCostMultiplier <= 0 ||
    spec.repairCostMultiplier > 3
  )
    throw new Error("Capacity repair cost multiplier out of bounds");
}

export function capacityObligationId(
  conflictKey: string,
  resolutionId: string,
  regionId: string
): string {
  return `capacity:${conflictKey}:${resolutionId}:${regionId}`;
}

export interface CapacityRegionInput {
  regionId: string;
  regionName?: string;
  countryId: string;
  /** Current stock, already cold-start seeded by the caller when absent. */
  capitalStock: number;
  /** Destroyed capital still unrepaired from earlier outcomes in this region. */
  outstandingCapital: number;
}

export interface PlannedCapacityObligation {
  _id: string;
  regionId: string;
  regionName?: string;
  countryIdAtDestruction: string;
  capitalStockBefore: number;
  destroyedCapital: number;
}

export interface CapacityDestructionPlan {
  obligations: PlannedCapacityObligation[];
  summary: CapacityDestructionSummary;
}

/**
 * Size one outcome's destruction. Each named region loses its authored share of
 * the current stock, never pushing unrepaired damage above the outstanding
 * ceiling. Regions that are not modeled, or have no stock, are reported as
 * skipped rather than silently charged elsewhere.
 */
export function planCapacityDestruction(input: {
  spec: CapacityDestructionSpec;
  conflictKey: string;
  resolutionId: string;
  regions: readonly CapacityRegionInput[];
}): CapacityDestructionPlan {
  validateCapacityDestructionSpec(input.spec);
  const byId = new Map(input.regions.map((region) => [region.regionId, region]));
  const obligations: PlannedCapacityObligation[] = [];
  const skipped: CapacityDestructionSummary["skipped"] = [];
  let requestedShare = 0;
  let realizedShare = 0;
  for (const target of input.spec.regions) {
    requestedShare += target.capitalShare;
    const region = byId.get(target.regionId);
    const stock = finite(region?.capitalStock);
    if (!region) {
      skipped.push({ regionId: target.regionId, reason: "region_not_modeled" });
      continue;
    }
    if (stock <= 0) {
      skipped.push({ regionId: target.regionId, reason: "no_capital_stock" });
      continue;
    }
    const requested = stock * target.capitalShare;
    const headroom = Math.max(
      0,
      stock * input.spec.maxOutstandingShare - Math.max(0, finite(region.outstandingCapital))
    );
    const destroyed = round(Math.min(requested, headroom));
    if (destroyed <= 0) {
      skipped.push({ regionId: target.regionId, reason: "outstanding_ceiling" });
      continue;
    }
    realizedShare += target.capitalShare * (destroyed / requested);
    obligations.push({
      _id: capacityObligationId(input.conflictKey, input.resolutionId, target.regionId),
      regionId: target.regionId,
      ...(region.regionName ? { regionName: region.regionName } : {}),
      countryIdAtDestruction: region.countryId,
      capitalStockBefore: round(stock),
      destroyedCapital: destroyed,
    });
  }
  return {
    obligations,
    summary: {
      regions: obligations.map((obligation) => ({
        regionId: obligation.regionId,
        ...(obligation.regionName ? { regionName: obligation.regionName } : {}),
        countryId: obligation.countryIdAtDestruction,
        destroyedCapital: obligation.destroyedCapital,
        obligationId: obligation._id,
      })),
      skipped,
      realizedFraction: requestedShare > 0 ? Math.min(1, realizedShare / requestedShare) : 0,
    },
  };
}

/**
 * Infrastructure-track points an outcome converted into real destruction. Only
 * the share that landed on modeled regions is netted out of the standing
 * growth proxy, so an unmodeled region keeps its old charge instead of none.
 */
export function realizedInfrastructurePoints(
  trackBefore: number | undefined,
  trackAfter: number | undefined,
  realizedFraction: number
): number {
  const applied = Math.max(0, finite(trackAfter) - finite(trackBefore));
  const fraction = Math.max(0, Math.min(1, finite(realizedFraction)));
  return round(applied * fraction);
}

/** The track damage still charged through the potential-growth proxy. */
export function proxyInfrastructureDamage(track: number | undefined, realized: number | undefined) {
  return Math.max(0, finite(track) - Math.max(0, finite(realized)));
}

/** Spending category key for the national budget line that pays conflict repair. */
export const CAPACITY_REPAIR_SPENDING_KEY = "conflictCapacityRepair";

export interface RepairScheduleView {
  createdTurn: number;
  destroyedCapital: number;
  repairTurns: number;
  repairCostMultiplier: number;
}

/**
 * Share of the destruction repaired by `turn`: equal installments over the
 * `repairTurns` turns after the damage, none on the turn it happened.
 */
export function repairProgress(
  obligation: Pick<RepairScheduleView, "createdTurn" | "repairTurns">,
  turn: number
): number {
  const turns = Math.max(1, Math.round(finite(obligation.repairTurns)) || 1);
  const elapsed = finite(turn) - finite(obligation.createdTurn);
  return Math.max(0, Math.min(1, elapsed / turns));
}

/** Capital rebuilt by `turn`, local-currency millions. */
export function repairedCapitalAt(obligation: RepairScheduleView, turn: number): number {
  const destroyed = Math.max(0, finite(obligation.destroyedCapital));
  return round(destroyed * repairProgress(obligation, turn));
}

/**
 * Annualized local-currency spending the sovereign carries on `turn`. Zero
 * before the first installment turn and after the last, so the national budget
 * line is exactly the cost of the capital the stock regains that turn.
 */
export function annualRepairSpendingAt(obligation: RepairScheduleView, turn: number): number {
  const turns = Math.max(1, Math.round(finite(obligation.repairTurns)) || 1);
  const elapsed = finite(turn) - finite(obligation.createdTurn);
  if (elapsed < 1 || elapsed > turns) return 0;
  const destroyed = Math.max(0, finite(obligation.destroyedCapital));
  const multiplier = Math.max(0, finite(obligation.repairCostMultiplier));
  return Math.round((destroyed / turns) * CAPITAL_UNIT_LOCAL * multiplier * TURNS_PER_YEAR);
}

/** Unrepaired capital on `turn`, used to bound later outcomes in the same region. */
export function outstandingCapitalAt(
  obligations: readonly RepairScheduleView[],
  turn: number
): number {
  let total = 0;
  for (const obligation of obligations) {
    const destroyed = Math.max(0, finite(obligation.destroyedCapital));
    total += destroyed - repairedCapitalAt(obligation, turn);
  }
  return Math.max(0, total);
}

export interface CapacityLedgerEntry {
  id: string;
  destroyedCapital: number;
  fundedCapital: number;
}

export interface CapacityFoldResult {
  capitalStock: number;
  gdp: number;
  applied: ConflictCapacityApplied;
  /** Net change this fold made to the stock, local-currency millions. */
  capitalDelta: number;
  /** Obligations whose destruction and full repair are now both in the stock. */
  settledIds: string[];
}

/**
 * Fold not-yet-applied destruction and funded repair into a region's stock.
 * `applied` is persisted with the stock in one write, so a replayed fold
 * applies nothing twice. Output scales with the stock through the capital
 * share of the production function.
 */
export function foldCapacityLedger(input: {
  capitalStock: number;
  gdp: number;
  entries: readonly CapacityLedgerEntry[];
  applied: ConflictCapacityApplied | undefined;
  capitalShare?: number;
}): CapacityFoldResult {
  const stock = Math.max(0, finite(input.capitalStock));
  const gdp = Math.max(0, finite(input.gdp));
  const applied: ConflictCapacityApplied = { ...(input.applied ?? {}) };
  const settledIds: string[] = [];
  let delta = 0;
  for (const entry of input.entries) {
    const destroyed = Math.max(0, finite(entry.destroyedCapital));
    const funded = Math.min(destroyed, Math.max(0, finite(entry.fundedCapital)));
    const previous = applied[entry.id] ?? { destroyed: 0, repaired: 0 };
    const destroyStep = Math.max(0, destroyed - previous.destroyed);
    const repairStep = Math.max(0, funded - previous.repaired);
    delta += repairStep - destroyStep;
    applied[entry.id] = {
      destroyed: Math.max(previous.destroyed, destroyed),
      repaired: Math.max(previous.repaired, funded),
    };
    if (funded >= destroyed && destroyed > 0) settledIds.push(entry.id);
  }
  const next = Math.max(0, stock + delta);
  const alpha = Math.max(0, Math.min(1, input.capitalShare ?? CAPITAL_SHARE));
  const ratio = stock > 0 && next > 0 ? next / stock : 1;
  return {
    capitalStock: next,
    gdp: gdp * Math.pow(ratio, alpha),
    applied,
    capitalDelta: next - stock,
    settledIds,
  };
}
