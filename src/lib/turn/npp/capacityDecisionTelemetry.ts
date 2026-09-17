// src/lib/turn/npp/capacityDecisionTelemetry.ts
/**
 * Capacity-decision telemetry assembly for NPP corporation turns.
 *
 * Pure observation construction over data the turn shell already holds: the
 * rival index is built from the loaded sector snapshot (no turn-path reads),
 * cohorts never carry ids, and observations aggregate in memory for one bulk
 * flush. The decision engine in `nppCorporationBehavior.ts` records through
 * these builders; persistence lives in
 * `@/lib/corporations/capacityDecisionTelemetry/persistence`.
 */
import type { CorporateSector, Corporation } from "@/lib/db/types";
import {
  classifyCorporationManagement,
  type CorporationManagementCohort,
} from "@/lib/corporations/balanceAudit/rules";
import {
  FOUNDING_GATE_PRECEDENCE,
  REINVEST_GATE_PRECEDENCE,
  firstRejectingGate,
  type CapacityDecisionObservation,
  type ReinvestCapacityGate,
} from "@/lib/corporations/capacityDecisionTelemetry/rules";
import {
  dominanceDensityFactor,
  getDominanceGrowthCostMultiplier,
} from "@/lib/constants/corporations";
import {
  corpLiquidCapitalToAnchor,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";

/** In-memory rival corp ids per (state, sectorType) bucket. */
export type CapacityCompetitorIndex = Map<string, Set<string>>;

/**
 * Index rivals from the already-loaded sector snapshot, so observing adds no
 * turn-path reads.
 */
export function buildCapacityCompetitorIndex(
  sectors: readonly Pick<CorporateSector, "stateId" | "sectorType" | "corporationId">[]
): CapacityCompetitorIndex {
  const index: CapacityCompetitorIndex = new Map();
  for (const s of sectors) {
    if (!s.stateId || !s.sectorType || !s.corporationId) continue;
    const key = bucketKey(s.stateId, s.sectorType);
    let rivals = index.get(key);
    if (!rivals) {
      rivals = new Set();
      index.set(key, rivals);
    }
    rivals.add(s.corporationId.toString());
  }
  return index;
}

/** Rival count excluding the deciding corporation itself. */
export function makeCapacityCompetitorCounter(index: CapacityCompetitorIndex) {
  return (stateId: string, sectorType: string, ownCorporationId: string): number => {
    const rivals = index.get(bucketKey(stateId, sectorType));
    if (!rivals) return 0;
    return rivals.has(ownCorporationId) ? rivals.size - 1 : rivals.size;
  };
}

/** Management cohort for the observation vocabulary, never an id. */
export function resolveCapacityCohort(
  corp: Pick<Corporation, "ceoType" | "ceoVacant" | "countryOwnerId" | "ownershipState" | "userId">
): CorporationManagementCohort {
  return classifyCorporationManagement({
    ceoType: corp.ceoType ?? null,
    ceoVacant: corp.ceoVacant,
    countryOwnerId: corp.countryOwnerId ?? null,
    ownershipState: corp.ownershipState ?? null,
    userId: corp.userId?.toString() ?? null,
  });
}

/** Local-cash to anchor conversion bound to one corporation. */
export function makeCapacityCashToAnchor(
  corp: CorpCapitalCurrencyInfo,
  fxRate: number
): (amountLocal: number) => number {
  return (amountLocal: number) => corpLiquidCapitalToAnchor(amountLocal, corp, fxRate);
}

const CAPACITY_CREDIT_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "credit_cooldown",
  "credit_capacity",
  "credit_issuance_failed",
  "credit_rounding_shortfall",
]);

/**
 * Append one corp's observations to the cohort aggregate. A requested entry
 * whose credit pipeline failed is a cash rejection, not a near-entry, so the
 * funnel does not overstate credit demand.
 */
export function mergeCapacityObservations(
  target: CapacityDecisionObservation[],
  incoming: readonly CapacityDecisionObservation[] | undefined,
  entryReason: string | undefined
): void {
  if (!incoming) return;
  const creditFailed = CAPACITY_CREDIT_FAILURE_REASONS.has(entryReason ?? "");
  for (const observation of incoming) {
    if (creditFailed && observation.outcome === "credit_requested") {
      observation.outcome = "insufficient_cash";
    }
    target.push(observation);
  }
}

/** Affordability facts for the founding observation, priced or explicit-zero. */
export interface FoundingCapacityQuote {
  unitPriceAnchor: number;
  dominanceMultiplier: number;
  requestedUnits: number;
  cashHeadroomAnchor: number;
}

/** Mutable founding outcome tracked across the priced branches. */
export interface FoundingCapacityOutcome {
  affordable: boolean;
  creditPath: boolean;
  sizeBlocked: boolean;
  quote: FoundingCapacityQuote | null;
}

/** Blank outcome; whichever founding branch prices the candidate notes into it. */
export function createFoundingCapacityOutcome(): FoundingCapacityOutcome {
  return { affordable: false, creditPath: false, sizeBlocked: false, quote: null };
}

/** Record one branch's affordability facts; unpriced branches keep null quotes. */
export function noteFoundingCapacityOutcome(
  outcome: FoundingCapacityOutcome,
  facts: {
    affordable: boolean;
    creditPath: boolean;
    sizeBlocked: boolean;
    quote: FoundingCapacityQuote | null;
  }
): void {
  outcome.affordable = facts.affordable;
  outcome.creditPath = facts.creditPath;
  outcome.sizeBlocked = facts.sizeBlocked;
  outcome.quote = facts.quote;
}

/** Raw founding-gate inputs; the builder applies FOUNDING_GATE_PRECEDENCE. */
export interface FoundingCapacityGateInputs {
  allowExpansion: boolean;
  isProfitable: boolean;
  corpMargin: number;
  minMargin: number;
  entryCandidate: { stateId: string; sectorType: string } | null;
  hasLogisticsCapacity: boolean;
  marketEntryEligible: boolean;
  shortageEntryEligible: boolean;
  retailExpansionPaused: boolean;
  ordinaryEntryTargetGlutted: boolean;
  exceptionalShortageEntry: boolean;
  blockEntered: boolean;
  plantsEnabled: boolean;
  expansionPresent: boolean;
  surplusCash: number;
  minCash: number;
}

/**
 * One founding observation per corp per turn. The gate is the FIRST rejection
 * in FOUNDING_GATE_PRECEDENCE order (null means the candidate placed); priced
 * branches contribute the full quote, pre-pricing gates observe explicit zeros
 * with the fallback headroom, never a fabricated quote.
 */
export function buildFoundingCapacityObservation(args: {
  cohort: CorporationManagementCohort;
  competitorCount: number;
  outcome: FoundingCapacityOutcome;
  fallbackCashHeadroomAnchor: number;
  gates: FoundingCapacityGateInputs;
}): CapacityDecisionObservation {
  const g = args.gates;
  const o = args.outcome;
  // Legacy worlds have no surplus-cash band in the priced branch: the
  // ordinary-entry surplus gate is the cash rejection there.
  const surplusBlocked =
    !g.plantsEnabled &&
    g.expansionPresent &&
    g.hasLogisticsCapacity &&
    g.marketEntryEligible &&
    !g.ordinaryEntryTargetGlutted &&
    !(g.surplusCash > g.minCash) &&
    !g.exceptionalShortageEntry;
  const gate = firstRejectingGate(FOUNDING_GATE_PRECEDENCE, {
    strategy_disallowed: !g.allowExpansion,
    unprofitable: !g.isProfitable,
    margin_below_floor: g.corpMargin < g.minMargin,
    no_enterable_market: g.entryCandidate == null,
    logistics_capacity: !g.hasLogisticsCapacity,
    cohort_ineligible: !g.marketEntryEligible && g.shortageEntryEligible !== true,
    retail_paused: g.retailExpansionPaused === true && g.entryCandidate?.sectorType === "retail",
    glutted_market: g.ordinaryEntryTargetGlutted && !g.exceptionalShortageEntry,
    facility_size: g.blockEntered && !o.affordable && o.sizeBlocked,
    credit_requested: g.blockEntered && !o.affordable && o.creditPath,
    state_credit_restricted:
      g.blockEntered &&
      !o.affordable &&
      !o.creditPath &&
      !o.sizeBlocked &&
      g.exceptionalShortageEntry,
    insufficient_cash: (g.blockEntered && !o.affordable) || surplusBlocked,
  });
  return {
    actor: "npp",
    cohort: args.cohort,
    stage: "order",
    outcome: gate ?? "placed",
    marketSharePct: 0,
    competitorCount: args.competitorCount,
    rawDominanceMultiplier: getDominanceGrowthCostMultiplier(0),
    dominanceDensityFactor: dominanceDensityFactor(args.competitorCount),
    dominanceMultiplier: o.quote?.dominanceMultiplier ?? 1,
    unitPriceAnchor: o.quote?.unitPriceAnchor ?? 0,
    cashHeadroomAnchor: o.quote?.cashHeadroomAnchor ?? args.fallbackCashHeadroomAnchor,
    requestedUnits: o.quote?.requestedUnits ?? 0,
  };
}

/** Priced reinvestment quote in the observation vocabulary. */
export interface ReinvestCapacityPriced {
  unitPriceAnchor: number;
  dominanceMultiplier: number;
  cashHeadroomAnchor: number;
}

/** Pre-sizing gate flags, decided in REINVEST_GATE_PRECEDENCE order. */
export interface ReinvestPreSizingGateFlags {
  divested: boolean;
  mothballed: boolean;
  no_capacity: boolean;
  queue_full: boolean;
  no_telemetry: boolean;
  fill_below_min: boolean;
  state_controlled: boolean;
}

/**
 * First rejecting pre-sizing gate (divested through state-controlled), or null
 * when the candidate proceeds to sizing. Same conditions and order as the
 * sequential skips this replaces.
 */
export function evaluateReinvestPreSizingGate(
  flags: ReinvestPreSizingGateFlags
): ReinvestCapacityGate | null {
  return firstRejectingGate(REINVEST_GATE_PRECEDENCE, flags);
}

export interface ReinvestCapacityObserver {
  observe(
    gate: CapacityDecisionObservation["outcome"],
    sector: CorporateSector,
    capitalStock: number,
    headroomUnits: number | null,
    units: number,
    priced: ReinvestCapacityPriced | null
  ): void;
  observePriced(
    gate: CapacityDecisionObservation["outcome"],
    sector: CorporateSector,
    capitalStock: number,
    headroomUnits: number,
    units: number,
    costAnchor: number,
    dominanceMultiplier: number,
    cashHeadroomAnchor: number
  ): void;
}

/**
 * Observation for one evaluated reinvestment candidate. Market share mirrors
 * the pricing input (owned capacity over owned plus unowned headroom, read off
 * the same in-memory pool the sizing uses). Priced candidates carry the
 * charged quote; earlier gates observe an explicit zero price with headroom as
 * current cash, and the density-adjusted premium they would have paid.
 */
export function createReinvestCapacityObserver(deps: {
  cohort: CorporationManagementCohort;
  competitorCountOf: (stateId: string, sectorType: string) => number;
  cashToAnchor: (amountLocal: number) => number;
  readCashLocal: () => number;
  poolHeadroomOf: (sector: CorporateSector) => number;
  push: (observation: CapacityDecisionObservation) => void;
}): ReinvestCapacityObserver {
  const observe: ReinvestCapacityObserver["observe"] = (
    gate,
    sector,
    capitalStock,
    headroomUnits,
    units,
    priced
  ) => {
    const headroom = headroomUnits ?? deps.poolHeadroomOf(sector);
    const bucketTotal = capitalStock + headroom;
    const marketSharePct = bucketTotal > 0 ? (100 * capitalStock) / bucketTotal : 0;
    const competitors = deps.competitorCountOf(sector.stateId, sector.sectorType);
    const rawDominance = getDominanceGrowthCostMultiplier(marketSharePct);
    const density = dominanceDensityFactor(competitors);
    deps.push({
      actor: "npp",
      cohort: deps.cohort,
      stage: "order",
      outcome: gate,
      marketSharePct,
      competitorCount: competitors,
      rawDominanceMultiplier: rawDominance,
      dominanceDensityFactor: density,
      dominanceMultiplier: priced?.dominanceMultiplier ?? 1 + (rawDominance - 1) * density,
      unitPriceAnchor: priced?.unitPriceAnchor ?? 0,
      cashHeadroomAnchor: priced?.cashHeadroomAnchor ?? deps.cashToAnchor(deps.readCashLocal()),
      requestedUnits: units,
    });
  };
  return {
    observe,
    observePriced(
      gate,
      sector,
      capitalStock,
      headroomUnits,
      units,
      costAnchor,
      dominanceMultiplier,
      cashHeadroomAnchor
    ) {
      // Unit price off the charged total, exactly as the player quote reports
      // it; headroom is cash after the sized cost, matching `buildCapacity`.
      observe(gate, sector, capitalStock, headroomUnits, units, {
        unitPriceAnchor: units > 0 ? costAnchor / units : 0,
        dominanceMultiplier,
        cashHeadroomAnchor,
      });
    },
  };
}

/**
 * Append the one founding observation for a corp turn. The caller maps its
 * decision facts into gate inputs; the builder applies
 * FOUNDING_GATE_PRECEDENCE so the recorded gate is the same first-rejecting
 * gate the branch took.
 */
export function pushFoundingCapacityObservation(
  target: CapacityDecisionObservation[],
  args: {
    cohort: CorporationManagementCohort;
    competitorCount: number;
    outcome: FoundingCapacityOutcome;
    fallbackCashHeadroomAnchor: number;
    gates: FoundingCapacityGateInputs;
  }
): void {
  target.push(buildFoundingCapacityObservation(args));
}
