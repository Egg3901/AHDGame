/**
 * Authored civilian mortality removes residents once, without converting campaign scores.
 * planConflictCivilianLosses bounds explicit requests by sovereign civilian cohorts;
 * serving personnel remain reserved and the result names each affected region.
 */
import { totalPopulation, type AgeSexVector } from "@/lib/demographics/cohortVector";

export interface ConflictCivilianLossSpec {
  countryId: string;
  /** Gameplay assumption per resolved outcome, not a historical death estimate. */
  residentPopulationShare: number;
}

export const YUGOSLAV_ESCALATION_CIVILIAN_LOSS: ConflictCivilianLossSpec = {
  countryId: "YU",
  residentPopulationShare: 0.00005,
};

/** Freeze an explicit event request independently of later campaign pressure. */
export function requestedConflictCivilianLoss(
  spec: ConflictCivilianLossSpec,
  population: number
): number {
  if (
    !spec.countryId ||
    !Number.isFinite(spec.residentPopulationShare) ||
    spec.residentPopulationShare <= 0 ||
    spec.residentPopulationShare > 0.001 ||
    !Number.isFinite(population) ||
    population < 0
  )
    throw new Error("Invalid authored civilian loss or population");
  return population * spec.residentPopulationShare;
}

export interface ConflictCivilianLossOrder {
  _id: string;
  worldEpochId: string;
  interactionId: string;
  crisisId: string;
  outcomeId: string;
  countryId: string;
  regionIds: string[];
  effectiveTurn: number;
  requestedPeople: number;
  status: "pending" | "complete";
}

export interface ConflictCivilianLossRegion {
  regionId: string;
  countryId: string;
  vector: AgeSexVector;
  servingMaleByAge?: readonly number[];
  servingFemaleByAge?: readonly number[];
}

export interface ConflictCivilianLossResult {
  _id: string;
  worldEpochId: string;
  interactionId: string;
  crisisId: string;
  outcomeId: string;
  countryId: string;
  stock: "civilian-residents";
  appliedTurn: number;
  requestedPeople: number;
  deaths: number;
  regions: Array<{ regionId: string; deaths: number }>;
  reason:
    "applied" | "limited-by-civilian-stock" | "no-sovereign-region" | "no-available-civilians";
}

/** Same reduced stock is passed on to reception; deaths never become migration. */
export function planConflictCivilianLosses(
  orders: readonly ConflictCivilianLossOrder[],
  regions: readonly ConflictCivilianLossRegion[],
  turn: number,
  worldEpochId: string
): {
  regions: ConflictCivilianLossRegion[];
  results: ConflictCivilianLossResult[];
  deathsByRegion: Record<string, number>;
} {
  if (!worldEpochId || !Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Civilian losses require a world identity and valid turn");
  if (new Set(orders.map((order) => order._id)).size !== orders.length)
    throw new Error("Duplicate civilian loss order");
  if (new Set(regions.map((region) => region.regionId)).size !== regions.length)
    throw new Error("Duplicate civilian loss region");
  const projected = regions
    .map((region) => {
      for (const sex of ["male", "female"] as const) {
        const reserved = sex === "male" ? region.servingMaleByAge : region.servingFemaleByAge;
        if (
          region.vector[sex].length !== 101 ||
          region.vector[sex].some((cell) => !Number.isFinite(cell) || cell < 0) ||
          (reserved &&
            (reserved.length !== 101 ||
              reserved.some((cell) => !Number.isFinite(cell) || cell < 0)))
        )
          throw new Error("Invalid civilian cohort or serving reservation");
      }
      return {
        ...region,
        vector: { male: [...region.vector.male], female: [...region.vector.female] },
      };
    })
    .sort((a, b) => a.regionId.localeCompare(b.regionId));
  const populationBefore = projected.reduce(
    (sum, region) => sum + totalPopulation(region.vector),
    0
  );
  const deathsByRegion: Record<string, number> = {};
  const results: ConflictCivilianLossResult[] = [];
  for (const order of [...orders].sort((a, b) => a._id.localeCompare(b._id))) {
    if (order.worldEpochId !== worldEpochId)
      throw new Error("Civilian loss order belongs to another world");
    if (
      !order._id ||
      !order.countryId ||
      !Number.isFinite(order.requestedPeople) ||
      order.requestedPeople < 0 ||
      !Number.isSafeInteger(order.effectiveTurn) ||
      order.effectiveTurn < 1 ||
      new Set(order.regionIds).size !== order.regionIds.length
    )
      throw new Error("Invalid civilian loss order");
    if (order.status === "complete" || order.effectiveTurn > turn) continue;
    const authorized = new Set(order.regionIds);
    const eligible = projected.filter(
      (region) => authorized.has(region.regionId) && region.countryId === order.countryId
    );
    const available = eligible.map((region) => {
      const civilian: AgeSexVector = { male: [], female: [] };
      for (const sex of ["male", "female"] as const) {
        const serving = sex === "male" ? region.servingMaleByAge : region.servingFemaleByAge;
        civilian[sex] = region.vector[sex].map((cell, age) =>
          Math.max(0, cell - (serving?.[age] ?? 0))
        );
      }
      const civilianPeople = totalPopulation(civilian);
      // Preserve the regional population floor already used by demographics.
      const limit = Math.min(civilianPeople, Math.max(0, totalPopulation(region.vector) - 1));
      return { region, civilian, civilianPeople, limit };
    });
    const totalAvailable = available.reduce((sum, item) => sum + item.limit, 0);
    const requested = Math.min(order.requestedPeople, totalAvailable);
    const regionResults: ConflictCivilianLossResult["regions"] = [];
    for (const item of available) {
      if (!(item.limit > 0) || !(requested > 0)) continue;
      const deaths = (requested * item.limit) / totalAvailable;
      const fraction = deaths / item.civilianPeople;
      let removed = 0;
      for (const sex of ["male", "female"] as const) {
        for (let age = 0; age <= 100; age++) {
          const cellDeaths = item.civilian[sex][age] * fraction;
          item.region.vector[sex][age] -= cellDeaths;
          removed += cellDeaths;
        }
      }
      deathsByRegion[item.region.regionId] = (deathsByRegion[item.region.regionId] ?? 0) + removed;
      regionResults.push({ regionId: item.region.regionId, deaths: removed });
    }
    const deaths = regionResults.reduce((sum, region) => sum + region.deaths, 0);
    results.push({
      _id: order._id,
      worldEpochId,
      interactionId: order.interactionId,
      crisisId: order.crisisId,
      outcomeId: order.outcomeId,
      countryId: order.countryId,
      stock: "civilian-residents",
      appliedTurn: turn,
      requestedPeople: order.requestedPeople,
      deaths,
      regions: regionResults,
      reason:
        deaths > 0
          ? deaths < order.requestedPeople - 1e-7
            ? "limited-by-civilian-stock"
            : "applied"
          : eligible.length
            ? "no-available-civilians"
            : "no-sovereign-region",
    });
  }
  const populationAfter = projected.reduce(
    (sum, region) => sum + totalPopulation(region.vector),
    0
  );
  const deaths = results.reduce((sum, result) => sum + result.deaths, 0);
  if (
    Math.abs(populationBefore - populationAfter - deaths) > Math.max(1e-7, populationBefore * 1e-10)
  )
    throw new Error("Civilian mortality did not reconcile with population");
  return { regions: projected, results, deathsByRegion };
}
