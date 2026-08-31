import type { Db } from "mongodb";
import type { FederalBudget, GameState } from "@/lib/db/types";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { computeMarketDemand } from "@/lib/sovereignDefault/marketDemand";
import { computeDsa } from "@/lib/sovereignDefault/debtSustainability";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { loadNationalGdpGrowth } from "@/lib/country/nationalGdpGrowth";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";

function demandBand(ratio: number): "subscribed" | "undersubscribed" | "failed" {
  return ratio >= 1 ? "subscribed" : ratio >= 0.7 ? "undersubscribed" : "failed";
}

export async function querySovereignWatch(db: Db) {
  const currentTurn = await getCurrentTurn(db);
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });

  const countries = await Promise.all(
    COUNTRY_ORDER.map(async (countryId: CountryId) => {
      const [snapshot, budget, liveGdpGrowth] = await Promise.all([
        loadCountrySovereignSnapshot(db, countryId, currentTurn),
        db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: getNationalBudgetId(countryId) }),
        loadNationalGdpGrowth(db, countryId, gameState?.currentYear),
      ]);

      if (!snapshot || !budget) {
        return {
          countryId,
          countryName: COUNTRY_CONFIGS[countryId].name,
          found: false,
          crisisState: budget?.sovereignCrisisState ?? "normal",
        };
      }

      const demand = computeMarketDemand(snapshot);
      const ratioGdp = resolveRatioGdp(budget);
      const annualGdpGrowth = liveGdpGrowth ?? budget.economicFactors?.gdpGrowth ?? 0;
      const dsa = computeDsa({
        debtToGdp: snapshot.debtToGdp,
        primarySurplusToGdp: ratioGdp > 0 ? federalSurplus(budget) / ratioGdp : 0,
        fxDepreciation10t: snapshot.fxDepreciationRate10t,
        annualGdpGrowth: annualGdpGrowth / 100,
      });

      return {
        countryId,
        countryName: COUNTRY_CONFIGS[countryId].name,
        found: true,
        crisisState: budget.sovereignCrisisState ?? "normal",
        creditRating: budget.creditRating,
        failedAuctionConsecutiveCount: budget.failedAuctionConsecutiveCount ?? 0,
        turnsSinceLastDefault: snapshot.turnsSinceLastDefault,
        debtToGdpRatio: snapshot.debtToGdp,
        inflationRate: snapshot.inflationRate * 100,
        annualGdpGrowth,
        trust: snapshot.trust,
        sovereignCouponRate: snapshot.sovereignCouponRate,
        fxDepreciation10Turn: snapshot.fxDepreciationRate10t,
        entityHoldings: snapshot.entityHoldings,
        requiredIssuance: snapshot.requiredIssuance,
        demand: {
          ratio: demand.demandRatio,
          band: demandBand(demand.demandRatio),
          components: demand.components,
        },
        sustainability: dsa,
      };
    })
  );

  return { found: countries.some((country) => country.found), currentTurn, countries };
}
