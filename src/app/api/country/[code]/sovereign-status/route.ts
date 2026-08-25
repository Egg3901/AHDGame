// GET /api/country/[code]/sovereign-status — Synthetic market-demand signal + inputs.
// Auth: requireAuth
// Errors: 400 (invalid country code), 401, 404 (no federal budget for country)

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";
import { computeDsa } from "@/lib/sovereignDefault/debtSustainability";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";
import { loadNationalGdpGrowth } from "@/lib/country/nationalGdpGrowth";
import type { GameState } from "@/lib/db/types/gameState";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { code } = await params;
  const upperCode = code.toUpperCase() as CountryId;

  if (!COUNTRY_CONFIGS[upperCode]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const db = await getDb();
  const currentTurn = await getCurrentTurn(db);
  const snapshot = await loadCountrySovereignSnapshot(db, upperCode, currentTurn);

  if (!snapshot) {
    return NextResponse.json({ error: "Country budget not found" }, { status: 404 });
  }

  const demand = computeMarketDemand(snapshot);

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(upperCode) });

  // Live national growth, not `economicFactors.gdpGrowth`. That field is the
  // fiscal-year assumption frozen at the last rollover and can sit points away
  // from the rate every other page shows (UK: -5.32 stored against +6.24 live).
  // A forward-looking gauge must use the forward-looking number.
  // See lib/country/nationalGdpGrowth.
  const gameStateForGrowth = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const liveGdpGrowth = await loadNationalGdpGrowth(db, upperCode, gameStateForGrowth?.currentYear);

  // Phase 11a: forward-looking sustainability gauge. Pure math; reads from
  // the snapshot + budget surplus/gdp. Independent of the 3-failed-auctions
  // hard fire trigger.
  const dsa = computeDsa({
    debtToGdp: snapshot.debtToGdp,
    // Derived surplus over the smoothed GDP: the same two bases `snapshot.debtToGdp`
    // and every other fiscal surface use, so this gauge cannot disagree with the
    // debt ratio beside it. See lib/budget/federalSurplus + gdpDenominator.
    primarySurplusToGdp:
      budget && resolveRatioGdp(budget) > 0 ? federalSurplus(budget) / resolveRatioGdp(budget) : 0,
    fxDepreciation10t: snapshot.fxDepreciationRate10t ?? 0,
    // stored as percent; fall back to the frozen FY assumption only when the
    // country has neither a national metrics doc nor an authored era trend.
    annualGdpGrowth: (liveGdpGrowth ?? budget?.economicFactors?.gdpGrowth ?? 0) / 100,
  });

  // Phase 9b: surface either the open decision (crisisPending) OR the
  // executiveProposed decision (legislative ratification) so the UI panel
  // can render the right view.
  const surfacedDecisions = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .find({ countryCode: upperCode, state: { $in: ["open", "executiveProposed"] } })
    .sort({ firedAtTurn: -1 })
    .limit(1)
    .toArray();
  const surfaced = surfacedDecisions[0];
  const phase =
    surfaced?.state === "executiveProposed" &&
    typeof surfaced?.currentChamberIndex === "number" &&
    surfaced?.legislativePhases?.[surfaced.currentChamberIndex];
  const activeLegislativePhase = phase
    ? {
        chamberKey: phase.chamberKey,
        endsAtRealtimeMs: phase.endsAtRealtimeMs,
        endsOnTurn: phase.endsOnTurn ?? null,
        votesFor: phase.votesFor,
        votesAgainst: phase.votesAgainst,
        executiveChoice: surfaced.executiveChoice ?? null,
      }
    : null;

  return NextResponse.json({
    countryCode: upperCode,
    currentTurn,
    snapshot,
    demand,
    dsa,
    crisisState: budget?.sovereignCrisisState ?? "normal",
    openDecisionId: surfaced?.state === "open" ? (surfaced._id?.toString() ?? null) : null,
    activeLegislativePhase,
    crisisAutoActionAt: budget?.crisisAutoActionAt ?? null,
    recoveryStartedAt: budget?.recoveryStartedAt ?? null,
    recoveryFiscalDisciplineStreak: budget?.recoveryFiscalDisciplineStreak ?? 0,
    marketAccessLockedUntilTurn: budget?.marketAccessLockedUntilTurn ?? null,
    recoveryGdpPenaltyPercent: budget?.recoveryGdpPenaltyPercent ?? null,
    recoveryGdpPenaltyTurnsRemaining: budget?.recoveryGdpPenaltyTurnsRemaining ?? null,
    imfSovereignBailoutActive: budget?.imfSovereignBailoutActive ?? false,
    imfBoardOverrideWindowEndAt: budget?.imfBoardOverrideWindowEndAt ?? null,
  });
}
