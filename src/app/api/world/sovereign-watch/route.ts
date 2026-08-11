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

  // Parallel fan-out — small N (~8 countries) keeps this manageable. Each
  // country: snapshot load → demand calc → DSA calc + budget read for
  // crisis state / streak / lastDefault.
  const rows = await Promise.all(
    codes.map(async (code): Promise<SovereignWatchRow> => {
      const cfg = COUNTRY_CONFIGS[code];
      const [snapshot, budget] = await Promise.all([
        loadCountrySovereignSnapshot(db, code, currentTurn),
        db.collection<FederalBudget>("federalBudget").findOne({ _id: getNationalBudgetId(code) }),
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
        primarySurplusToGdp:
          budget.surplus !== undefined && budget.gdp && budget.gdp > 0
            ? budget.surplus / budget.gdp
            : 0,
        fxDepreciation10t: snapshot.fxDepreciationRate10t ?? 0,
        annualGdpGrowth: (budget.economicFactors?.gdpGrowth ?? 0) / 100,
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
