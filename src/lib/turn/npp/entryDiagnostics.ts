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

export type {
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
  NppMarketEntryReason,
} from "@/lib/db/types/marketFormation";

export const NPP_MARKET_ENTRY_FUNNEL_COLLECTION = "nppMarketEntryFunnels";
export const NPP_MARKET_ENTRY_FUNNEL_RETENTION_TURNS = 48;

export function initialNppMarketEntryReason(args: {
  strategyAllowsExpansion: boolean;
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
  hasCandidate: boolean;
  hasLogisticsCapacity: boolean;
  cohortEligible: boolean;
}): NppMarketEntryReason {
  if (!args.strategyAllowsExpansion) return "strategy_disallowed";
  if (!args.profitable) return "unprofitable";
  if (args.marginPct < args.marginFloorPct) return "margin_below_floor";
  if (!args.hasCandidate) return "no_enterable_market";
  if (!args.hasLogisticsCapacity) return "logistics_capacity";
  if (!args.cohortEligible) return "cohort_ineligible";
  return "cash_floor";
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
}): NppMarketEntryDiagnostic {
  const reason = initialNppMarketEntryReason({
    strategyAllowsExpansion: args.strategyAllowsExpansion,
    profitable: args.profitable,
    marginPct: args.marginPct,
    marginFloorPct: args.marginFloorPct,
    hasCandidate: args.target != null,
    hasLogisticsCapacity: args.hasLogisticsCapacity,
    cohortEligible: args.cohortEligible,
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
