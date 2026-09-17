/**
 * Pure, privacy-safe contract for aggregate capacity-decision telemetry.
 *
 * This module answers the T821 audit question ("does the marginal dominance
 * build premium change capacity decisions?") with evidence instead of
 * anecdotes. Every capacity decision — a player build preview or placement, an
 * NPP founding evaluation, an NPP reinvestment candidate — is observed with
 * the SAME vocabulary:
 *
 *   market      marketSharePct (0-100), competitorCount
 *   dominance   rawDominanceMultiplier, dominanceDensityFactor,
 *               dominanceMultiplier (density-adjusted, as charged)
 *   price       unitPriceAnchor (anchor ₳ per capacity unit)
 *   cash        cashHeadroomAnchor (anchor ₳ left after the sized cost)
 *   demand      requestedUnits
 *   who         actor, cohort (management cohort, never an id)
 *   outcome     placed, quoted, or the FIRST rejecting gate
 *
 * Privacy: observations carry no player, NPP, corporation, sector, or state
 * identifiers. Only per-bucket sums and counts leave the process (see
 * `aggregateCapacityDecisions`); the bucket key is a closed vocabulary, so the
 * persisted document holds a bounded number of keys. Balance constants live
 * elsewhere — this module prices nothing and gates nothing, it only names the
 * gates the shells evaluate.
 *
 * Field semantics for rejected candidates: a candidate rejected BEFORE it is
 * priced has no quote, so unitPriceAnchor is 0 and requestedUnits is the sized
 * quantity when sizing ran, else 0. cashHeadroomAnchor is post-cost headroom
 * once the candidate is priced, otherwise the deployable surplus over the cash
 * floor (founding) or current cash (reinvestment) — enough to tell
 * cash-constrained rejections from rule rejections, not enough to price
 * anything.
 */

import type { CorporationManagementCohort } from "../balanceAudit/rules";

export const CAPACITY_DECISION_SCHEMA_VERSION = 2 as const;

export type CapacityDecisionActor = "player" | "npp";
export type CapacityDecisionCohort = CorporationManagementCohort;
export type CapacityDecisionStage = "quote" | "order";

/**
 * Shared outcome vocabulary for player and NPP capacity paths.
 *
 * The first five are the player build route's historical outcomes. The rest
 * are first-rejecting gates, in evaluation order within each path (see
 * FOUNDING_GATE_PRECEDENCE / REINVEST_GATE_PRECEDENCE): at most one is
 * recorded per candidate, the earliest gate that rejected it.
 */
export type CapacityDecisionOutcome =
  | "quoted"
  | "placed"
  | "queue_full"
  | "insufficient_cash"
  | "concurrent_change"
  | "strategy_disallowed"
  | "unprofitable"
  | "margin_below_floor"
  | "no_enterable_market"
  | "logistics_capacity"
  | "cohort_ineligible"
  | "retail_paused"
  | "glutted_market"
  | "facility_size"
  | "credit_requested"
  | "state_credit_restricted"
  | "divested"
  | "mothballed"
  | "no_capacity"
  | "no_telemetry"
  | "fill_below_min"
  | "state_controlled"
  | "below_minimum_order";

/** Gates evaluated on the NPP founding path, earliest first. */
export type FoundingCapacityGate = Extract<
  CapacityDecisionOutcome,
  | "strategy_disallowed"
  | "unprofitable"
  | "margin_below_floor"
  | "no_enterable_market"
  | "logistics_capacity"
  | "cohort_ineligible"
  | "retail_paused"
  | "glutted_market"
  | "facility_size"
  | "credit_requested"
  | "state_credit_restricted"
  | "insufficient_cash"
>;

/** Gates evaluated per NPP reinvestment candidate, earliest first. */
export type ReinvestCapacityGate = Extract<
  CapacityDecisionOutcome,
  | "divested"
  | "mothballed"
  | "no_capacity"
  | "queue_full"
  | "no_telemetry"
  | "fill_below_min"
  | "state_controlled"
  | "below_minimum_order"
  | "insufficient_cash"
>;

/**
 * Founding gate precedence. Mirrors the evaluation order in the NPP expansion
 * section: broad eligibility first (strategy, profitability, margin,
 * candidate, logistics, cohort — the same order as the market-entry
 * diagnostic), then demand and affordability. The shell MUST evaluate in this
 * order; the tests pin it.
 */
export const FOUNDING_GATE_PRECEDENCE = [
  "strategy_disallowed",
  "unprofitable",
  "margin_below_floor",
  "no_enterable_market",
  "logistics_capacity",
  "cohort_ineligible",
  "retail_paused",
  "glutted_market",
  "facility_size",
  "credit_requested",
  "state_credit_restricted",
  "insufficient_cash",
] as const satisfies readonly FoundingCapacityGate[];

/**
 * Reinvestment gate precedence. Mirrors the candidate loop order in the NPP
 * reinvestment section: identity/state gates, demand-evidence gates, then
 * sizing and affordability. The shell MUST evaluate in this order.
 */
export const REINVEST_GATE_PRECEDENCE = [
  "divested",
  "mothballed",
  "no_capacity",
  "queue_full",
  "no_telemetry",
  "fill_below_min",
  "state_controlled",
  "below_minimum_order",
  "insufficient_cash",
] as const satisfies readonly ReinvestCapacityGate[];

export interface CapacityDecisionObservation {
  actor: CapacityDecisionActor;
  cohort: CapacityDecisionCohort;
  stage: CapacityDecisionStage;
  outcome: CapacityDecisionOutcome;
  marketSharePct: number;
  competitorCount: number;
  rawDominanceMultiplier: number;
  dominanceDensityFactor: number;
  dominanceMultiplier: number;
  unitPriceAnchor: number;
  cashHeadroomAnchor: number;
  requestedUnits: number;
}

export interface CapacityDecisionAggregate {
  observations: number;
  marketSharePctSum: number;
  competitorCountSum: number;
  rawDominanceMultiplierSum: number;
  dominanceDensityFactorSum: number;
  dominanceMultiplierSum: number;
  unitPriceAnchorSum: number;
  cashHeadroomAnchorSum: number;
  requestedUnitsSum: number;
}

export interface CapacityDecisionFunnelSummary {
  denominators: {
    observations: number;
    requestedUnits: number;
  };
  buckets: Record<string, CapacityDecisionAggregate & { observationShare: number | null }>;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function capacityDecisionBucketKey(
  observation: Pick<CapacityDecisionObservation, "actor" | "cohort" | "stage" | "outcome">
): string {
  return `${observation.actor}:${observation.cohort}:${observation.stage}:${observation.outcome}`;
}

/**
 * First-rejecting-gate selection. `flags` maps each gate to whether the
 * candidate was rejected there; the earliest gate in `precedence` that is true
 * wins, and null (the candidate proceeds) wins when none is true. Gates the
 * shell never evaluated are passed as false-or-absent, never as true.
 */
export function firstRejectingGate<G extends string>(
  precedence: readonly G[],
  flags: Partial<Record<G, boolean>>
): G | null {
  for (const gate of precedence) {
    if (flags[gate] === true) return gate;
  }
  return null;
}

export function aggregateCapacityDecisions(
  observations: readonly CapacityDecisionObservation[]
): Record<string, CapacityDecisionAggregate> {
  const result: Record<string, CapacityDecisionAggregate> = {};
  for (const observation of observations) {
    const key = capacityDecisionBucketKey(observation);
    const bucket = (result[key] ??= {
      observations: 0,
      marketSharePctSum: 0,
      competitorCountSum: 0,
      rawDominanceMultiplierSum: 0,
      dominanceDensityFactorSum: 0,
      dominanceMultiplierSum: 0,
      unitPriceAnchorSum: 0,
      cashHeadroomAnchorSum: 0,
      requestedUnitsSum: 0,
    });
    bucket.observations++;
    bucket.marketSharePctSum += finite(observation.marketSharePct);
    bucket.competitorCountSum += finite(observation.competitorCount);
    bucket.rawDominanceMultiplierSum += finite(observation.rawDominanceMultiplier);
    bucket.dominanceDensityFactorSum += finite(observation.dominanceDensityFactor);
    bucket.dominanceMultiplierSum += finite(observation.dominanceMultiplier);
    bucket.unitPriceAnchorSum += finite(observation.unitPriceAnchor);
    bucket.cashHeadroomAnchorSum += finite(observation.cashHeadroomAnchor);
    bucket.requestedUnitsSum += finite(observation.requestedUnits);
  }
  return result;
}

/**
 * Read-time funnel summary over persisted aggregate buckets. Denominators are
 * world totals for share math; per-bucket observationShare is null only when
 * there is nothing to share (empty input). Aggregate buckets stay closed under
 * $inc writes (see persistence), so shares are derived here, at read time.
 */
export function summarizeCapacityDecisionBuckets(
  buckets: Record<string, CapacityDecisionAggregate>
): CapacityDecisionFunnelSummary {
  let observations = 0;
  let requestedUnits = 0;
  for (const bucket of Object.values(buckets)) {
    observations += finite(bucket.observations);
    requestedUnits += finite(bucket.requestedUnitsSum);
  }
  const summarized: CapacityDecisionFunnelSummary["buckets"] = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    summarized[key] = {
      ...bucket,
      observationShare: observations > 0 ? finite(bucket.observations) / observations : null,
    };
  }
  return { denominators: { observations, requestedUnits }, buckets: summarized };
}
