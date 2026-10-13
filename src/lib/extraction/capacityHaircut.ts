import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import {
  EXTRACTABLE_RESOURCES,
  eraScaledBasePrices,
  extractionOutputScaleFor,
} from "@/lib/constants/commodities";

/**
 * Extraction capacity → revenue haircut.
 *
 * Extraction sectors are output-clamped by their operating state's resource
 * capacity (see computeExtractionCapacityMultipliers). Historically that clamp
 * only reduced the sector's contribution to the commodity MARKET supply — the
 * corp still booked full revenue for output it could not physically extract
 * (audit t786). This module makes the clamp bite realized revenue: a sector
 * that can only extract X% of its revenue-based potential realizes X% of its
 * resource revenue.
 *
 * Because the live game had extraction pinned at ~33% utilization, applying the
 * full haircut instantly would erase ~57% of extraction-sector revenue and
 * bankrupt miners. So the haircut fades in over a transition window (mirrors the
 * nationalization productivity shock): each sector stamps a start turn the first
 * time it is processed, and the haircut ramps linearly from none → full over
 * EXTRACTION_CAPACITY_HAIRCUT_TURNS, giving corps time to acquire capacity,
 * specialize, or divest before the constraint fully bites.
 */

/** Transition window (turns) over which the capacity haircut fades to full. 5 game years. */
export const EXTRACTION_CAPACITY_HAIRCUT_TURNS = 240;

/** One-turn utilization drop that restarts the capacity haircut ramp. */
export const RAMP_REANCHOR_DELTA = 0.25;

/**
 * Most a sector's extraction capacity utilization may RISE in one turn. Falls
 * apply at once (a deposit that runs out is out); rises ease in so a corrected
 * reading (the anchor-currency fix lifted 56 live mines' ceilings ~2.5x) or a
 * sudden deposit change cannot dump a step of new supply and input demand into
 * one turn. 0.05 takes a mine from fully bound to unbound over 20 turns.
 */
export const EXTRACTION_UTILIZATION_MAX_RISE_PER_TURN = 0.05;

/** `next` utilization, held to at most MAX_RISE above last turn's persisted value. */
export function limitExtractionUtilizationRise(
  next: { utilization: number; bindingResource: ExtractableResource | null },
  prior: number | null | undefined
): { utilization: number; bindingResource: ExtractableResource | null } {
  if (typeof prior !== "number" || !Number.isFinite(prior)) return next;
  const cap = Math.max(0, prior) + EXTRACTION_UTILIZATION_MAX_RISE_PER_TURN;
  return next.utilization > cap ? { ...next, utilization: cap } : next;
}

/** Utilization below this is treated as "capacity bound" for display/alerts. */
export const CAPACITY_BINDING_THRESHOLD = 0.9;

/**
 * Floor on the extraction capacity haircut. Rev-weighted extraction utilization
 * has collapsed to ~0.07, so the unfloored ramp drives realized extraction
 * revenue toward −93% (far past the −57% the mechanic was designed for) and has
 * already pushed several mining corps insolvent. Clamp the realized factor to 0.5
 * so the worst case is −50% while the capacity/adoption fixes raise real
 * utilization. Passed explicitly at the extraction call site only — the
 * market-rework clearing/throughput ramps keep their own flooring (throughput
 * already floors at THROUGHPUT_MIN), so this does not change their behaviour.
 */
export const EXTRACTION_CAPACITY_HAIRCUT_FLOOR = 0.5;

/**
 * Scarcity relief for the capacity haircut (week-1 clearing balance pass,
 * t900). The flat haircut taxes extraction revenue exactly where the economy
 * most needs MORE extraction: a rare-earth miner in a 4× shortage bears the
 * same clamp as a coal miner in a glut. Relief scales the haircut off per
 * resource by that resource's GLOBAL supply/demand:
 *
 *   s/d ≤ 0.5  → full relief (no haircut on that resource's leg)
 *   s/d ≥ 1.0  → no relief   (full haircut, as today)
 *   between    → linear
 *
 * This is an incentive, not a handout — the moment supply catches up, the
 * relief self-deactivates and the physical clamp resumes.
 */
export const HAIRCUT_SCARCITY_RELIEF_FULL_SD = 0.5;
export const HAIRCUT_SCARCITY_RELIEF_NONE_SD = 1.0;

/** Relief fraction (0..1) for a resource, given its global supply/demand. */
export function haircutScarcityRelief(
  supplyUnits: number | undefined,
  demandUnits: number | undefined
): number {
  if (!(typeof supplyUnits === "number") || !(typeof demandUnits === "number")) return 0;
  if (!(demandUnits > 0)) return 0;
  const sd = Math.max(0, supplyUnits) / demandUnits;
  if (sd <= HAIRCUT_SCARCITY_RELIEF_FULL_SD) return 1;
  if (sd >= HAIRCUT_SCARCITY_RELIEF_NONE_SD) return 0;
  return (
    (HAIRCUT_SCARCITY_RELIEF_NONE_SD - sd) /
    (HAIRCUT_SCARCITY_RELIEF_NONE_SD - HAIRCUT_SCARCITY_RELIEF_FULL_SD)
  );
}

/**
 * Desired extraction output on the same unit basis as the world supply ledger.
 */
export function extractionDesiredUnits(
  revenueAnchor: number,
  supplyRate: number,
  resource: ExtractableResource,
  eraUnitScale: number,
  extractionOutputScaleEnabled: boolean
): number {
  return (
    (revenueAnchor *
      supplyRate *
      extractionOutputScaleFor(resource, extractionOutputScaleEnabled)) /
    eraScaledBasePrices(eraUnitScale)[resource]
  );
}

function weightedCapacityUtilizationWithRelief(
  supplyRates: Partial<Record<CommodityType, number>>,
  multipliers: Partial<Record<ExtractableResource, number>> | undefined,
  reliefByResource: Partial<Record<ExtractableResource, number>> | undefined
): { utilization: number; bindingResource: ExtractableResource | null } {
  let rateSum = 0;
  let weighted = 0;
  let bindingResource: ExtractableResource | null = null;
  let minMult = Infinity;

  for (const resource of EXTRACTABLE_RESOURCES) {
    const rate = supplyRates[resource] ?? 0;
    if (rate <= 0) continue;
    const rawMult = multipliers?.[resource] ?? 1;
    const relief = reliefByResource?.[resource] ?? 0;
    const mult = relief > 0 ? Math.min(1, rawMult + (1 - rawMult) * Math.min(1, relief)) : rawMult;
    rateSum += rate;
    weighted += rate * mult;
    if (mult < minMult) {
      minMult = mult;
      bindingResource = resource;
    }
  }

  if (rateSum <= 0) return { utilization: 1, bindingResource: null };
  return {
    utilization: weighted / rateSum,
    bindingResource: minMult < 1 ? bindingResource : null,
  };
}

/**
 * Revenue-weighted capacity utilization for an extraction sector.
 * weightedUtil = Σ(supplyRate_r × multiplier_r) / Σ(supplyRate_r)
 *
 * `multipliers` is the per-sector map from computeExtractionCapacityMultipliers
 * (resource → 0..1). Resources the sector produces but that are missing from the
 * map are treated as unconstrained (multiplier 1) — a state with no capacity doc
 * is uncapped. Returns 1 (no haircut) when the sector has no extractable output.
 */
export function weightedCapacityUtilization(
  supplyRates: Partial<Record<CommodityType, number>>,
  multipliers: Partial<Record<ExtractableResource, number>> | undefined
): { utilization: number; bindingResource: ExtractableResource | null } {
  return weightedCapacityUtilizationWithRelief(supplyRates, multipliers, undefined);
}

/**
 * Capacity utilization with scarcity relief capped by the physical deposit
 * ceiling.
 *
 * The relief exists so a shortage stops taxing exactly the extraction revenue
 * the economy needs. Against the corrected ledger-basis output figures,
 * though, an unconstrained relief can lift utilization fully to 1 for a
 * sector whose desired output is many times its state's capacity: the corp
 * would book revenue for ore the deposits cannot physically yield.
 *
 * The raw capacity ratio bounds that: the share of the sector's DESIRED
 * output (in corrected units) its multipliers actually permit,
 *
 *   ratio = Σ(units_r × multiplier_r) / Σ(units_r)
 *
 * The relieved, rate-weighted utilization is honored only up to this ratio;
 * past it the physical clamp wins and the unrelieved figure is returned.
 * When no corrected units are recorded this is exactly
 * weightedCapacityUtilization.
 */
export function scarcityReliefCappedUtilization(
  supplyRates: Partial<Record<CommodityType, number>>,
  multipliers: Partial<Record<ExtractableResource, number>> | undefined,
  reliefByResource?: Partial<Record<ExtractableResource, number>>,
  /** Corrected desired output per resource, same basis as the multipliers. */
  desiredOutputUnits?: Partial<Record<ExtractableResource, number>>
): { utilization: number; bindingResource: ExtractableResource | null } {
  const relieved = weightedCapacityUtilizationWithRelief(
    supplyRates,
    multipliers,
    reliefByResource
  );

  let unitSum = 0;
  let unitWeightedRaw = 0;
  for (const resource of EXTRACTABLE_RESOURCES) {
    const units = desiredOutputUnits?.[resource] ?? 0;
    if (!(units > 0)) continue;
    unitSum += units;
    unitWeightedRaw += units * (multipliers?.[resource] ?? 1);
  }
  if (!(unitSum > 0)) return relieved;
  const rawCapacityRatio = unitWeightedRaw / unitSum;
  if (relieved.utilization <= rawCapacityRatio) return relieved;

  // The cap binds: report the physical ratio and the resource that binds it.
  let minMult = Infinity;
  let binding: ExtractableResource | null = null;
  for (const resource of EXTRACTABLE_RESOURCES) {
    if (!((desiredOutputUnits?.[resource] ?? 0) > 0)) continue;
    const rawMult = multipliers?.[resource] ?? 1;
    if (rawMult < minMult) {
      minMult = rawMult;
      binding = resource;
    }
  }
  return {
    utilization: rawCapacityRatio,
    bindingResource: minMult < 1 ? binding : null,
  };
}

/**
 * Transition-ramped revenue multiplier for the capacity haircut.
 * Fades from 1.0 (no haircut) at the start turn to `utilization` after the
 * full EXTRACTION_CAPACITY_HAIRCUT_TURNS window.
 *
 *   factor = 1 − rampProgress × (1 − utilization)
 *
 * Returns 1 when utilization is ≥ 1 (nothing to clamp) or inputs are missing.
 */
export function capacityHaircutFactor(
  utilization: number,
  startTurn: number | undefined | null,
  currentTurn: number | undefined | null,
  floor: number = 0,
  minRampProgress: number = 0
): number {
  if (utilization >= 1) return 1;
  const phaseOut = Math.max(0, Math.min(1, minRampProgress));
  if ((startTurn == null || currentTurn == null) && phaseOut <= 0) return 1;
  const since = startTurn == null || currentTurn == null ? 0 : currentTurn - startTurn;
  if (since <= 0 && phaseOut <= 0) return 1;
  // `minRampProgress` (no-buyer phase-out) can only speed the ramp up.
  const rampProgress = Math.max(
    phaseOut,
    Math.min(1, Math.max(0, since) / EXTRACTION_CAPACITY_HAIRCUT_TURNS)
  );
  const factor = 1 - rampProgress * (1 - utilization);
  // `floor` clamps the realized factor (extraction passes
  // EXTRACTION_CAPACITY_HAIRCUT_FLOOR); default 0 = unfloored for other callers.
  return floor > 0 ? Math.max(floor, factor) : factor;
}

/**
 * No-buyer phase-out window. A mine whose recipe has no leg its state can
 * extract offers nothing to the clearing book, so every unit the deposit ramps
 * still credit it is output nobody bought. Those ramps close over this many
 * turns from the world's phase-out start, so no mine loses its whole revenue
 * in one turn.
 */
export const EXTRACTION_NO_BUYER_PHASE_OUT_TURNS = 24;

/** Progress in [0, 1] through the no-buyer phase-out; 0 before it starts. */
export function noBuyerPhaseOutProgress(
  startTurn: number | undefined | null,
  currentTurn: number | undefined | null
): number {
  if (startTurn == null || currentTurn == null) return 0;
  return Math.max(0, Math.min(1, (currentTurn - startTurn) / EXTRACTION_NO_BUYER_PHASE_OUT_TURNS));
}

/** The haircut floor for a mine `progress` of the way through the phase-out. */
export function noBuyerHaircutFloor(progress: number): number {
  return EXTRACTION_CAPACITY_HAIRCUT_FLOOR * (1 - Math.max(0, Math.min(1, progress)));
}
