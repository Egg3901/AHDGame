/**
 * Formula grant distribution — federal pool → per-state allocations.
 *
 * **Currency (v0.2.6):** Every flow stays within a single country (federal pool
 * → that country's state budgets), so grant amounts inherit the country's
 * currency on both sides. No FX conversion is required. Cross-country grants
 * do not exist in this system.
 */
import type { Db } from "mongodb";
import type { FormulaGrant, StateBudget } from "@/lib/db/types/budget";
import type { CountryId } from "@/lib/constants/countries";
import { formulaGrants } from "@/lib/seeds/reference/formulaGrants";

interface StateData {
  id: string;
  population: number;
  povertyRate: number;
}

export async function getStateData(db: Db, countryId?: CountryId): Promise<StateData[]> {
  const states = await db
    .collection("states")
    .find(countryId ? { countryId } : {})
    .toArray();

  const stateIds = states.map((s) => String(s._id));
  const metricsDocs = await db
    .collection("macroMetrics")
    .find(
      { stateId: { $in: stateIds } },
      { projection: { stateId: 1, "economic.povertyRate.value": 1 } }
    )
    .toArray();
  const metricsMap = new Map<string, { economic?: { povertyRate?: { value?: number } } }>();
  for (const doc of metricsDocs) {
    metricsMap.set(
      String((doc as Record<string, unknown>).stateId),
      doc as { economic?: { povertyRate?: { value?: number } } }
    );
  }

  return states.map((state) => {
    const metrics = metricsMap.get(String(state._id));
    return {
      id: String(state._id),
      population: state.population || 1000000,
      povertyRate: metrics?.economic?.povertyRate?.value || 0.12,
    };
  });
}

export function calculateFormulaDistribution(
  program: FormulaGrant,
  poolAmount: number,
  states: StateData[]
): Record<string, number> {
  const distribution: Record<string, number> = {};

  switch (program.formulaType) {
    case "population": {
      const totalPop = states.reduce((sum, s) => sum + s.population, 0);
      for (const state of states) {
        distribution[state.id] = poolAmount * (state.population / totalPop);
      }
      break;
    }

    case "poverty": {
      const totalPovertyPop = states.reduce((sum, s) => sum + s.population * s.povertyRate, 0);
      for (const state of states) {
        const statePovertyPop = state.population * state.povertyRate;
        distribution[state.id] = poolAmount * (statePovertyPop / totalPovertyPop);
      }
      break;
    }

    case "hybrid": {
      const weights = program.hybridWeights || { population: 0.5, poverty: 0.5 };
      const totalPop = states.reduce((sum, s) => sum + s.population, 0);
      const totalPovertyPop = states.reduce((sum, s) => sum + s.population * s.povertyRate, 0);

      for (const state of states) {
        const popShare = state.population / totalPop;
        const povertyShare = (state.population * state.povertyRate) / totalPovertyPop;
        distribution[state.id] =
          poolAmount * (weights.population * popShare + weights.poverty * povertyShare);
      }
      break;
    }

    case "matching": {
      const totalPop = states.reduce((sum, s) => sum + s.population, 0);
      for (const state of states) {
        distribution[state.id] = poolAmount * (state.population / totalPop);
      }
      break;
    }
  }

  return distribution;
}

export async function processFormulaGrants(
  db: Db,
  federalBudgetTotal: number,
  countryId?: CountryId
): Promise<Record<string, number>> {
  const states = await getStateData(db, countryId);
  const stateGrants: Record<string, number> = {};

  for (const state of states) {
    stateGrants[state.id] = 0;
  }

  for (const program of formulaGrants) {
    const poolAmount = federalBudgetTotal * (program.poolPercentage / 100);
    const distribution = calculateFormulaDistribution(program, poolAmount, states);

    for (const [stateId, amount] of Object.entries(distribution)) {
      stateGrants[stateId] = (stateGrants[stateId] || 0) + amount;
    }
  }

  return stateGrants;
}

export async function updateStateGrantRevenue(
  db: Db,
  stateId: string,
  countryId: CountryId,
  grantAmount: number
): Promise<void> {
  await db.collection<StateBudget>("stateBudgets").updateOne(
    { _id: stateId, countryId },
    {
      $set: {
        "revenue.federalGrants": grantAmount,
        updatedAt: new Date(),
      },
    }
  );
}
