/**
 * Committee rate execution uses the currency anchor's current exchange-rate
 * commitment and persisted marketization. loadExecutionPolicies batches these
 * inputs so both live ballots and the turn phase enforce the same restrictions.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FederalBudget } from "@/lib/db/types/budget";
import { COMMAND_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { StateContext } from "./governanceShell";

type ExecutionPolicy = Pick<StateContext, "fxCommitment" | "commandEconomy">;

export async function loadExecutionPolicies(
  db: Db,
  countryIds: CountryId[],
  currentYear: number | null | undefined,
  commandEconomyEnabled: boolean
): Promise<Map<CountryId, ExecutionPolicy>> {
  const ids = [...new Set(countryIds)];
  if (ids.length === 0) return new Map();
  const [exchangeRates, budgets] = await Promise.all([
    db
      .collection<ExchangeRate>("exchangeRates")
      .find(
        { countryId: { $in: ids } },
        { projection: { countryId: 1, fxRegime: 1, capitalControls: 1 } }
      )
      .toArray(),
    commandEconomyEnabled
      ? db
          .collection<FederalBudget>("federalBudget")
          .find(
            { _id: { $in: ids.map(getNationalBudgetId) } },
            { projection: { "economicFactors.marketizationLevel": 1 } }
          )
          .toArray()
      : Promise.resolve([]),
  ]);
  const fxByCountry = new Map(exchangeRates.map((fx) => [fx.countryId, fx]));
  const budgetById = new Map(budgets.map((budget) => [budget._id, budget]));
  return new Map(
    ids.map((countryId) => {
      const fx = fxByCountry.get(countryId);
      const persisted = budgetById.get(getNationalBudgetId(countryId))?.economicFactors
        ?.marketizationLevel;
      const level =
        typeof persisted === "number" && Number.isFinite(persisted)
          ? persisted
          : scheduledMarketizationLevel(countryId, currentYear);
      return [
        countryId,
        {
          fxCommitment: fx
            ? { regime: fx.fxRegime ?? "float", capitalControls: fx.capitalControls === true }
            : null,
          commandEconomy: commandEconomyEnabled && level < COMMAND_CEILING,
        },
      ];
    })
  );
}
