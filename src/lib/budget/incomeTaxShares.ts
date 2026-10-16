/**
 * Income-tax bases follow the world's census. Country shares weight regions by
 * population and groups by relative earnings, preserving total taxable income.
 */
import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { FederalBudget, StateBudget, State } from "@/lib/db/types";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { resolveGameYear } from "@/lib/era/era";
import { getUsSubstrateForYear, getCountrySubstrateForYear } from "@/lib/seeds/eraSubstrateForYear";
import {
  DEFAULT_INCOME_POPULATION,
  incomeBaseShares,
  countryIncomeShares,
  aggregateIncomeTaxRate,
  type IncomeShares,
} from "./rules/incomeTaxTiers";

export function regionIncomePopulation(
  state: Pick<State, "_id" | "countryId">,
  preset: string,
  year?: number | null
): IncomeShares {
  const live =
    year == null
      ? null
      : state.countryId === "US"
        ? getUsSubstrateForYear(state._id, year)?.config
        : getCountrySubstrateForYear(state.countryId, state._id, year)?.marginals;
  const census =
    live ??
    getRegionCensusData(state.countryId, state._id, preset) ??
    getCountryLayer1Model(state.countryId, eraForPreset(preset))?.census[state._id];
  const groups =
    census && ("income" in census ? census.income : "wealth" in census ? census.wealth : undefined);
  if (!groups) return DEFAULT_INCOME_POPULATION;
  return { low: groups.low ?? 0, middle: groups.middle ?? 0, high: groups.high ?? 0 };
}

/** Four batched reads and two batched writes, independent of population size. */
export async function refreshIncomeTaxShares(db: Db): Promise<void> {
  const [gameState, states, national, regional] = await Promise.all([
    db
      .collection<{
        _id: string;
        preset?: string;
        currentYear?: number;
        currentTurn?: number;
        startingYear?: number;
      }>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { preset: 1, currentYear: 1, currentTurn: 1, startingYear: 1 } }
      ),
    db
      .collection<State>("states")
      .find({}, { projection: { countryId: 1, population: 1, parentRegionId: 1 } })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1, taxRates: 1 } })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({}, { projection: { countryId: 1, taxRates: 1 } })
      .toArray(),
  ]);
  const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  const year = resolveGameYear(gameState ?? {});
  const populationByRegion = new Map(
    states.map((state) => [state._id, regionIncomePopulation(state, preset, year)])
  );
  const nationalOps: AnyBulkWriteOperation<FederalBudget>[] = national
    .filter((budget) => budget.taxRates)
    .map((budget) => {
      const shares = countryIncomeShares(
        states
          .filter((state) => state.countryId === budget.countryId)
          .map((state) => ({
            population: state.population,
            parentRegionId: state.parentRegionId,
            income: populationByRegion.get(state._id)!,
          }))
      );
      return {
        updateOne: {
          filter: { _id: budget._id, taxRates: budget.taxRates },
          update: {
            $set: {
              incomeTaxShares: shares,
              "taxRates.incomeTax": aggregateIncomeTaxRate(budget.taxRates, shares),
            },
          },
        },
      };
    });
  const regionalOps: AnyBulkWriteOperation<StateBudget>[] = regional
    .filter((budget) => budget.taxRates)
    .map((budget) => {
      const shares = incomeBaseShares(
        populationByRegion.get(budget._id) ?? DEFAULT_INCOME_POPULATION
      );
      return {
        updateOne: {
          filter: { _id: budget._id, countryId: budget.countryId, taxRates: budget.taxRates },
          update: {
            $set: {
              incomeTaxShares: shares,
              "taxRates.incomeTax": aggregateIncomeTaxRate(budget.taxRates, shares),
            },
          },
        },
      };
    });
  if (nationalOps.length)
    await db.collection<FederalBudget>("federalBudget").bulkWrite(nationalOps);
  if (regionalOps.length) await db.collection<StateBudget>("stateBudgets").bulkWrite(regionalOps);
}
