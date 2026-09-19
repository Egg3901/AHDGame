import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { issueRelocationBond, previewRelocationBond } from "@/lib/corporations/issueRelocationBond";
import type {
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
  NppMarketEntryReason,
} from "@/lib/db/types/marketFormation";
import {
  NPP_MARKET_ENTRY_FUNNEL_COLLECTION,
  NPP_MARKET_ENTRY_FUNNEL_RETENTION_TURNS,
} from "./entryFunnelSnapshot";

export type {
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
  NppMarketEntryReason,
} from "@/lib/db/types/marketFormation";

export {
  NPP_MARKET_ENTRY_FUNNEL_COLLECTION,
  NPP_MARKET_ENTRY_FUNNEL_RETENTION_TURNS,
  normalizeNppMarketEntryFunnel,
} from "./entryFunnelSnapshot";

/**
 * Counts of candidate pools excluded by each `findBestUnownedSector` filter,
 * so a null candidate still reports WHICH filter bound instead of collapsing
 * every miss into `no_enterable_market`.
 */
export interface NppCandidateExclusions {
  occupiedExcluded: number;
  emptyPoolExcluded: number;
  stateControlledExcluded: number;
  depositExcluded: number;
}

export function blankNppCandidateExclusions(): NppCandidateExclusions {
  return {
    occupiedExcluded: 0,
    emptyPoolExcluded: 0,
    stateControlledExcluded: 0,
    depositExcluded: 0,
  };
}

/**
 * One reproducible primary reason per NPP entry candidate, in the same
 * evaluation order as the founding gates (see FOUNDING_GATE_PRECEDENCE in
 * capacityDecisionTelemetry/rules, mirrored here for the entry funnel):
 * strategy, profitability, margin, candidacy, logistics, cohort, retail pause,
 * glut, per-turn cap, then the pre-pricing cash floor. Priced outcomes
 * (entered, founding cost, credit, facility size) overwrite this afterwards
 * via `resolveFoundingShortfallReason`.
 *
 * Frontier matching and corporation-type coverage are preferences with
 * country-pool fallbacks, never hard gates, so they are reported as the
 * `frontierFallback` / `openMarketTypeFallback` flags rather than reasons.
 * Planned-economy restriction arrives as the state-controlled filter on
 * nationalized buckets and reports as `state_controlled`.
 */
export function initialNppMarketEntryReason(args: {
  strategyAllowsExpansion: boolean;
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
  hasCandidate: boolean;
  hasLogisticsCapacity: boolean;
  cohortEligible: boolean;
  retailBlocked?: boolean;
  targetGlutted?: boolean;
  entryCapReached?: boolean;
  candidateExclusions?: NppCandidateExclusions;
}): NppMarketEntryReason {
  if (!args.strategyAllowsExpansion) return "strategy_disallowed";
  if (!args.profitable) return "unprofitable";
  if (args.marginPct < args.marginFloorPct) return "margin_below_floor";
  if (!args.hasCandidate) {
    const exclusions = args.candidateExclusions;
    const otherExcluded =
      (exclusions?.occupiedExcluded ?? 0) +
      (exclusions?.emptyPoolExcluded ?? 0) +
      (exclusions?.depositExcluded ?? 0);
    if ((exclusions?.stateControlledExcluded ?? 0) > 0 && otherExcluded === 0) {
      return "state_controlled";
    }
    return "no_enterable_market";
  }
  if (!args.hasLogisticsCapacity) return "logistics_capacity";
  if (!args.cohortEligible) return "cohort_ineligible";
  if (args.retailBlocked === true) return "retail_paused";
  if (args.targetGlutted === true) return "glutted_market";
  if (args.entryCapReached === true) return "entry_cap";
  return "cash_floor";
}

/**
 * Post-pricing reason for a candidate that reached the founding block but did
 * not place: real founding-cost unaffordability is distinct from the
 * pre-pricing cash floor (which only checks a nominal surplus band). Mirrors
 * the priced branch order in `makeNppCorpDecision`: affordability, credit,
 * facility size, then the state-owned/IMF credit restriction.
 */
export function resolveFoundingShortfallReason(args: {
  creditPath: boolean;
  sizeBlocked: boolean;
  exceptionalShortageEntry: boolean;
}): NppMarketEntryReason {
  if (args.creditPath) return "credit_requested";
  if (args.sizeBlocked) return "facility_size";
  if (args.exceptionalShortageEntry) return "state_credit_restricted";
  return "founding_cost";
}

export function buildNppMarketEntryDiagnostic(args: {
  corporation: Corporation;
  sectorCount: number;
  logisticsSupportedSectors: number;
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
  cohortEligible: boolean;
  strategyAllowsExpansion: boolean;
  hasLogisticsCapacity: boolean;
  target?: { stateId: string; sectorType: CorporationType } | null;
  shortageScore?: number;
  frontierStates: ReadonlySet<string>;
  retailBlocked?: boolean;
  targetGlutted?: boolean;
  entryCapReached?: boolean;
  candidateExclusions?: NppCandidateExclusions;
}): NppMarketEntryDiagnostic {
  const reason = initialNppMarketEntryReason({
    strategyAllowsExpansion: args.strategyAllowsExpansion,
    profitable: args.profitable,
    marginPct: args.marginPct,
    marginFloorPct: args.marginFloorPct,
    hasCandidate: args.target != null,
    hasLogisticsCapacity: args.hasLogisticsCapacity,
    cohortEligible: args.cohortEligible,
    retailBlocked: args.retailBlocked,
    targetGlutted: args.targetGlutted,
    entryCapReached: args.entryCapReached,
    candidateExclusions: args.candidateExclusions,
  });
  return {
    corporationId: args.corporation._id.toString(),
    countryId: args.corporation.countryId,
    reason,
    sectorCount: args.sectorCount,
    logisticsSupportedSectors: args.logisticsSupportedSectors,
    profitable: args.profitable,
    marginPct: args.marginPct,
    marginFloorPct: args.marginFloorPct,
    cohortEligible: args.cohortEligible,
    strategyAllowsExpansion: args.strategyAllowsExpansion,
    targetStateId: args.target?.stateId,
    targetSectorType: args.target?.sectorType,
    shortageScore: args.shortageScore,
    frontierFallback:
      args.target != null &&
      args.frontierStates.size > 0 &&
      !args.frontierStates.has(args.target.stateId),
    openMarketTypeFallback:
      args.target != null &&
      args.target.sectorType !== args.corporation.type &&
      args.target.sectorType !== args.corporation.secondaryType,
  };
}

type CreditDecision = {
  shortageCreditRequest?: { amountLocal: number; sectorType: CorporationType };
  entryDiagnostic?: NppMarketEntryDiagnostic;
};

export async function resolveNppMarketEntryCredit<T extends CreditDecision>(args: {
  db: Db;
  corporation: Corporation;
  decision: T;
  turn: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  corpFxRate: number;
  retry: (creditLocal: number) => T;
}): Promise<T> {
  const request = args.decision.shortageCreditRequest;
  if (!request) return args.decision;
  const roundedLocal = Math.ceil(request.amountLocal / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
  const requestedAnchor = corpLiquidCapitalToAnchor(
    roundedLocal,
    args.corporation,
    args.corpFxRate
  );
  const preflight = await previewRelocationBond(
    args.db,
    args.corporation,
    requestedAnchor,
    args.turn,
    args.fxByCurrency
  );
  if (!preflight.ok) {
    return {
      ...args.decision,
      entryDiagnostic: setNppMarketEntryReason(
        args.decision.entryDiagnostic,
        preflight.cooldownTurnsRemaining != null ? "credit_cooldown" : "credit_capacity"
      ),
    };
  }
  const issued = await issueRelocationBond(
    args.db,
    args.corporation,
    requestedAnchor,
    args.turn,
    preflight,
    args.fxByCurrency
  );
  if (!issued.ok) {
    return {
      ...args.decision,
      entryDiagnostic: setNppMarketEntryReason(
        args.decision.entryDiagnostic,
        "credit_issuance_failed"
      ),
    };
  }
  if (issued.data.bondFaceValueLocal < request.amountLocal) {
    return {
      ...args.decision,
      entryDiagnostic: setNppMarketEntryReason(
        args.decision.entryDiagnostic,
        "credit_rounding_shortfall"
      ),
    };
  }
  return args.retry(issued.data.bondFaceValueLocal);
}

export function summarizeNppMarketEntryFunnel(args: {
  turn: number;
  now: Date;
  diagnostics: NppMarketEntryDiagnostic[];
  id?: string;
}): NppMarketEntryFunnel {
  const reasonCounts: Partial<Record<NppMarketEntryReason, number>> = {};
  for (const diagnostic of args.diagnostics) {
    reasonCounts[diagnostic.reason] = (reasonCounts[diagnostic.reason] ?? 0) + 1;
  }
  const entered = reasonCounts.entered ?? 0;
  return {
    _id: args.id ?? `turn:${args.turn}`,
    schemaVersion: 1,
    turn: args.turn,
    generatedAt: args.now,
    corporationsObserved: args.diagnostics.length,
    entered,
    rejected: Math.max(0, args.diagnostics.length - entered),
    reasonCounts,
    diagnostics: args.diagnostics,
  };
}

export async function persistNppMarketEntryFunnel(
  db: Db,
  turn: number,
  now: Date,
  diagnostics: NppMarketEntryDiagnostic[]
): Promise<NppMarketEntryFunnel> {
  const turnDoc = summarizeNppMarketEntryFunnel({ turn, now, diagnostics });
  const currentDoc = { ...turnDoc, _id: "current" };
  const collection = db.collection<NppMarketEntryFunnel>(NPP_MARKET_ENTRY_FUNNEL_COLLECTION);
  await collection.bulkWrite([
    { replaceOne: { filter: { _id: turnDoc._id }, replacement: turnDoc, upsert: true } },
    { replaceOne: { filter: { _id: "current" }, replacement: currentDoc, upsert: true } },
  ]);
  await collection.deleteMany({
    _id: { $ne: "current" },
    turn: { $lt: Math.max(0, turn - NPP_MARKET_ENTRY_FUNNEL_RETENTION_TURNS + 1) },
  });
  return turnDoc;
}

export async function persistNppMarketEntryFunnelBestEffort(
  db: Db,
  turn: number,
  now: Date,
  diagnostics: NppMarketEntryDiagnostic[]
): Promise<void> {
  try {
    await persistNppMarketEntryFunnel(db, turn, now, diagnostics);
  } catch (error) {
    console.warn("[npp-entry-funnel] Failed to persist diagnostic snapshot", error);
  }
}

export function setNppMarketEntryReason(
  diagnostic: NppMarketEntryDiagnostic | undefined,
  reason: NppMarketEntryReason
): NppMarketEntryDiagnostic | undefined {
  return diagnostic ? { ...diagnostic, reason } : undefined;
}
