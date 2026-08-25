// GET /api/world/sovereign-watch — Per-country sovereign-debt early-warning dashboard.
// Auth: requireAuth.
//
// Returns each configured country's current crisis state, demand ratio, DSA
// score, failed-auction streak, and turns-since-last-default. Powers the
// "Sovereign Debt Watch" panel on /world/crises.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";
import { computeDsa, type DsaResult } from "@/lib/sovereignDefault/debtSustainability";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import { loadNationalGdpGrowth } from "@/lib/country/nationalGdpGrowth";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";

interface SovereignWatchRow {
  countryCode: CountryId;
  countryName: string;
  crisisState: string;
  demandRatio: number | null;
  dsa: DsaResult | null;
  failedAuctionConsecutiveCount: number;
  turnsSinceLastDefault: number | null;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const currentTurn = await getCurrentTurn(db);
  const codes: CountryId[] = COUNTRY_ORDER;
  // Hoisted out of the per-country fan-out: the year cannot change mid-request,
  // so this is one read for the whole route rather than one per country.
  const gameStateForGrowth = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });

  // Parallel fan-out — small N (~8 countries) keeps this manageable. Each
  // country: snapshot load → demand calc → DSA calc + budget read for
  // crisis state / streak / lastDefault.
  const rows = await Promise.all(
    codes.map(async (code): Promise<SovereignWatchRow> => {
      const cfg = COUNTRY_CONFIGS[code];
      const [snapshot, budget, liveGdpGrowth] = await Promise.all([
        loadCountrySovereignSnapshot(db, code, currentTurn),
        db.collection<FederalBudget>("federalBudget").findOne({ _id: getNationalBudgetId(code) }),
        // Live national growth, not the frozen FY assumption in
        // `economicFactors.gdpGrowth`. See lib/country/nationalGdpGrowth.
        loadNationalGdpGrowth(db, code, gameStateForGrowth?.currentYear),
      ]);
      if (!snapshot || !budget) {
        return {
          countryCode: code,
          countryName: cfg.name,
          crisisState: budget?.sovereignCrisisState ?? "normal",
          demandRatio: null,
          dsa: null,
          failedAuctionConsecutiveCount: budget?.failedAuctionConsecutiveCount ?? 0,
          turnsSinceLastDefault:
            typeof budget?.lastDefaultTurn === "number"
              ? currentTurn - budget.lastDefaultTurn
              : null,
        };
      }

      const demand = computeMarketDemand(snapshot);
      const dsa = computeDsa({
        debtToGdp: snapshot.debtToGdp,
        // Same two bases as `snapshot.debtToGdp` and the per-country
        // sovereign-status route. See lib/budget/federalSurplus + gdpDenominator.
        primarySurplusToGdp:
          resolveRatioGdp(budget) > 0 ? federalSurplus(budget) / resolveRatioGdp(budget) : 0,
        fxDepreciation10t: snapshot.fxDepreciationRate10t ?? 0,
        // Falls back to the frozen FY assumption only when the country has
        // neither a national metrics doc nor an authored era trend.
        annualGdpGrowth: (liveGdpGrowth ?? budget.economicFactors?.gdpGrowth ?? 0) / 100,
      });

      return {
        countryCode: code,
        countryName: cfg.name,
        crisisState: budget.sovereignCrisisState ?? "normal",
        demandRatio: demand.demandRatio,
        dsa,
        failedAuctionConsecutiveCount: budget.failedAuctionConsecutiveCount ?? 0,
        turnsSinceLastDefault:
          typeof budget.lastDefaultTurn === "number" ? currentTurn - budget.lastDefaultTurn : null,
      };
    })
  );

  return NextResponse.json({ currentTurn, rows });
}
