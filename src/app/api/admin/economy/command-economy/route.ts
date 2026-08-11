// GET /api/admin/economy/command-economy
// Compact per-country planned-economy readouts for operator verification.
// Auth: requireAdmin
// Errors: 401, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameConfig, GameState } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { MARKETIZATION_SCHEDULE, plannedShare } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { presentPlannedEconomy } from "@/lib/economy/presentPlannedEconomy";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const scheduledIds = Object.keys(MARKETIZATION_SCHEDULE) as CountryId[];

    const [gameState, gameConfig, budgets] = await Promise.all([
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1, currentTurn: 1 } }),
      db
        .collection<GameConfig>("gameConfig")
        .findOne(
          { _id: "default" },
          { projection: { commandEconomyEnabled: 1, commandEconomySecondEconomyTolerance: 1 } }
        ),
      db
        .collection<FederalBudget>("federalBudget")
        .find(
          { _id: { $in: scheduledIds.map((id) => getNationalBudgetId(id)) } },
          {
            projection: {
              countryId: 1,
              "economicFactors.monetaryOverhang": 1,
              "economicFactors.shortageIndex": 1,
              "economicFactors.blackMarketPremium": 1,
              "economicFactors.secondEconomyShare": 1,
              // P1 read-path fix: the stored-level registry is process-local, so
              // this API process must read the persisted level to render the dial.
              "economicFactors.marketizationLevel": 1,
            },
          }
        )
        .toArray(),
    ]);

    const currentYear = gameState?.currentYear ?? null;
    const enabled = gameConfig?.commandEconomyEnabled === true;
    const budgetByCountry = new Map<string, FederalBudget>();
    for (const b of budgets) {
      const cid = b.countryId ?? (b._id === "federal" ? "US" : String(b._id));
      budgetByCountry.set(cid, b);
    }

    const rows = scheduledIds.flatMap((countryId) => {
      const factors = budgetByCountry.get(countryId)?.economicFactors;
      const view = presentPlannedEconomy(countryId, currentYear, enabled, factors);
      if (!view) return [];
      return [
        {
          countryId,
          countryName: COUNTRY_CONFIGS[countryId]?.name ?? countryId,
          regime: view.regime,
          regimeLabel: view.regimeLabel,
          marketizationLevel: view.marketizationLevel,
          plannedShare: plannedShare(countryId, currentYear, enabled),
          monetaryOverhang: view.monetaryOverhang,
          shortageIndex: view.shortageIndex,
          blackMarketPremium: view.blackMarketPremium,
          secondEconomyShare: view.secondEconomyShare,
        },
      ];
    });

    return NextResponse.json({
      enabled,
      currentYear,
      currentTurn: gameState?.currentTurn ?? null,
      secondEconomyTolerance: gameConfig?.commandEconomySecondEconomyTolerance ?? null,
      rows,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
