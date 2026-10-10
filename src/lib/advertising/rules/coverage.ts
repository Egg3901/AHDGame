/**
 * Portable coverage rules for advertising agreements (issue #2235).
 *
 * Rules zone: plain data in, plain data out. No database, clock, randomness,
 * environment, or network. The turn shell loads operating models, sector
 * footprints, and technology counts and passes them in.
 *
 * Coverage is supplier reach by state: a national component from owned
 * Media and Entertainment operating models (diminishing returns across
 * models), a footprint boost where the supplier runs active sectors, and a
 * small technology term. Overlap weights that reach by the buyer's
 * revenue-weighted operating states. Everything is bounded: coverage and
 * overlap live in [0, 1], efficacy in [1, 1 + AD_MAX_COVERAGE_BONUS].
 */
import { effectiveMediaOperatingModelId } from "@/lib/mediaOperatingModels/catalog";

/** National reach per operating model. Provisional: worldsim re-tunes. */
export const MODEL_NATIONAL_REACH: Record<string, number> = {
  broadcast_tv: 0.5,
  cable_tv: 0.4,
  streaming_platform: 0.45,
  radio_network: 0.35,
  film_studio: 0.25,
  newspaper: 0.2,
  music_label: 0.2,
  publishing_house: 0.15,
};

/** How much of the national model reach carries into any single state. */
export const AD_STATE_CARRY = 0.6;
/** Coverage boost for states where the supplier runs an active sector. */
export const AD_FOOTPRINT_BOOST = 0.35;
/** Technology lift per relevant unlocked technology. */
export const AD_TECH_LIFT_EACH = 0.02;
/** Cap on the total technology lift. */
export const AD_TECH_LIFT_CAP = 0.1;
/** Efficacy ceiling: full-overlap contracted spend is worth at most this much extra. */
export const AD_MAX_COVERAGE_BONUS = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Minimal sector shape the coverage rules read. */
export interface CoverageSectorInput {
  stateId: string;
  revenue: number;
  sectorType?: string;
  countryId?: string | null;
  mothballed?: boolean;
  embargoSuspended?: boolean;
  activeCapacityPercent?: number;
  /** Strategy id; a media operating model id when the sector runs one. */
  strategyId?: string | null;
}

/** Operating models a supplier runs for advertising, including implicit defaults. */
export function operatingModelsFromSectors(
  sectors: readonly CoverageSectorInput[],
  year: number | null | undefined
): string[] {
  const models: string[] = [];
  for (const sector of sectors) {
    const id = effectiveMediaOperatingModelId(sector.strategyId, sector.sectorType ?? "", year);
    if (!id || !Object.hasOwn(MODEL_NATIONAL_REACH, id)) continue;
    if (!isSectorActiveForCoverage(sector) || models.includes(id)) continue;
    models.push(id);
  }
  return models;
}

/** True when a sector counts as operating footprint for coverage. */
export function isSectorActiveForCoverage(
  sector: Pick<CoverageSectorInput, "mothballed" | "embargoSuspended" | "activeCapacityPercent">
): boolean {
  if (sector.mothballed === true) return false;
  if (sector.embargoSuspended === true) return false;
  const capacity =
    typeof sector.activeCapacityPercent === "number" &&
    Number.isFinite(sector.activeCapacityPercent)
      ? sector.activeCapacityPercent
      : 100;
  return capacity > 0;
}

/** National model reach with diminishing returns across owned models. */
export function nationalModelReach(operatingModels: readonly string[] | undefined): number {
  if (!operatingModels || operatingModels.length === 0) return 0;
  const seen = new Set<string>();
  let complement = 1;
  for (const model of operatingModels) {
    if (typeof model !== "string" || seen.has(model)) continue;
    seen.add(model);
    const reach = MODEL_NATIONAL_REACH[model] ?? 0;
    if (reach > 0) complement *= 1 - Math.min(1, reach);
  }
  return clamp01(1 - complement);
}

export function technologyLift(relevantTechCount: number | undefined): number {
  return Math.min(AD_TECH_LIFT_CAP, toCount(relevantTechCount) * AD_TECH_LIFT_EACH);
}

export interface SupplierCoverageArgs {
  operatingModels: readonly string[];
  supplierSectors: readonly CoverageSectorInput[];
  relevantTechCount?: number;
  /** States to score. Coverage is only meaningful where the buyer operates. */
  states: readonly string[];
}

/**
 * Supplier reach by state. Footprint states get the active-sector boost;
 * every state carries the national model component plus technology.
 */
export function supplierCoverageByState(args: SupplierCoverageArgs): Map<string, number> {
  const national = nationalModelReach(args.operatingModels) * AD_STATE_CARRY;
  const tech = technologyLift(args.relevantTechCount);
  const footprint = new Set<string>();
  for (const sector of args.supplierSectors) {
    if (typeof sector.stateId !== "string" || sector.stateId.length === 0) continue;
    if (isSectorActiveForCoverage(sector)) footprint.add(sector.stateId);
  }
  const out = new Map<string, number>();
  for (const stateId of args.states) {
    out.set(
      stateId,
      round4(clamp01(national + tech + (footprint.has(stateId) ? AD_FOOTPRINT_BOOST : 0)))
    );
  }
  return out;
}

export interface BuyerWeightArgs {
  buyerSectors: readonly CoverageSectorInput[];
  headquartersState?: string;
}

/**
 * Revenue-weighted operating weights over the buyer's active sectors. Falls
 * back to the headquarters state when no active sector books revenue, so a
 * buyer always has a defined footprint.
 */
export function buyerOperatingWeights(args: BuyerWeightArgs): Map<string, number> {
  const byState = new Map<string, number>();
  let total = 0;
  for (const sector of args.buyerSectors) {
    if (!isSectorActiveForCoverage(sector)) continue;
    if (typeof sector.stateId !== "string" || sector.stateId.length === 0) continue;
    const revenue =
      typeof sector.revenue === "number" && Number.isFinite(sector.revenue)
        ? Math.max(0, sector.revenue)
        : 0;
    if (revenue <= 0) continue;
    byState.set(sector.stateId, (byState.get(sector.stateId) ?? 0) + revenue);
    total += revenue;
  }
  if (total > 0) {
    const out = new Map<string, number>();
    for (const [stateId, revenue] of byState) out.set(stateId, round4(revenue / total));
    return out;
  }
  if (typeof args.headquartersState === "string" && args.headquartersState.length > 0) {
    return new Map([[args.headquartersState, 1]]);
  }
  return new Map();
}

/**
 * Revenue-weighted overlap between supplier coverage and the buyer's
 * operating states, in [0, 1]. Zero when the buyer has no footprint or the
 * supplier reaches none of it.
 */
export function coverageOverlap(
  buyerWeights: ReadonlyMap<string, number>,
  supplierCoverage: ReadonlyMap<string, number>
): number {
  let overlap = 0;
  for (const [stateId, weight] of buyerWeights) {
    if (!(weight > 0)) continue;
    overlap += weight * (supplierCoverage.get(stateId) ?? 0);
  }
  return round4(clamp01(overlap));
}

/**
 * Efficacy multiplier for delivery-covered contracted spend: 1.0 (neutral)
 * with no overlap, up to 1 + AD_MAX_COVERAGE_BONUS at full overlap. Spot and
 * uncovered spend always use 1.0 directly and never call this.
 */
export function efficacyFactorForOverlap(overlap: number): number {
  return round4(1 + clamp01(overlap) * AD_MAX_COVERAGE_BONUS);
}

/**
 * Bounded multiplier a buyer's paid advertising earns toward product brand:
 * effective over settled spend, never below neutral and never above the
 * coverage ceiling. Missing or zero spend is neutral.
 */
export function advertisingEfficacyFactor(
  settledSpendAnchor: number,
  effectiveAnchor: number
): number {
  if (!(settledSpendAnchor > 0) || !Number.isFinite(effectiveAnchor)) return 1;
  const ratio = effectiveAnchor / settledSpendAnchor;
  if (!Number.isFinite(ratio)) return 1;
  return round4(Math.min(1 + AD_MAX_COVERAGE_BONUS, Math.max(1, ratio)));
}

/**
 * Paid advertising scaled by the coverage efficacy of the settlement written
 * for the same turn. A missing or different-turn settlement is neutral, so
 * brand formation never reads efficacy that belongs to another turn's spend.
 */
export function efficacyAdjustedAdvertising(
  paidAnchor: number,
  receiptTurn: number,
  efficacy: { turn: number; factor: number } | undefined
): number {
  if (!efficacy || efficacy.turn !== receiptTurn) return paidAnchor;
  const factor = Math.min(1 + AD_MAX_COVERAGE_BONUS, Math.max(1, efficacy.factor));
  return paidAnchor * factor;
}
