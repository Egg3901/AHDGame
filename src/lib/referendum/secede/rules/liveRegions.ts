/** Independence preserves the live nation economy while allocating it to its new regions. */
import type { State } from "@/lib/db/types/state";
import { gdpWeights, populationWeights, largestRemainderAllocate } from "../apportion";

export function expandLiveRegions(aggregate: State, seeds: State[]): State[] {
  if (
    !Number.isFinite(aggregate.gdp) ||
    !Number.isFinite(aggregate.population) ||
    aggregate.gdp <= 0 ||
    aggregate.population <= 0
  ) {
    throw new Error("Independence requires a live population and GDP");
  }
  const populations = populationWeights(seeds);
  const output = gdpWeights(seeds);
  const counts = [
    "population",
    "votingEligiblePopulation",
    "workingAgePopulation",
    "militaryServicePopulation",
  ] as const;
  const allocated = Object.fromEntries(
    counts.map((key) => [
      key,
      aggregate[key] === undefined
        ? undefined
        : largestRemainderAllocate(aggregate[key]!, populations),
    ])
  );
  return seeds.map((seed) => {
    const row: State = {
      ...structuredClone(seed),
      ...structuredClone(aggregate),
      _id: seed._id,
      countryId: seed.countryId,
      regionType: seed.regionType,
      name: seed.name,
      region: seed.region,
      houseDistricts: seed.houseDistricts,
      stateSenateSeats: seed.stateSenateSeats,
    };
    delete row.parentRegionId;
    delete row.topSectorsCache;
    const weight = output[seed._id];
    for (const key of counts) {
      const values = allocated[key];
      if (values) row[key] = values[seed._id];
    }
    for (const key of [
      "gdp",
      "capitalStock",
      "sectorRealizedRevenue",
      "sectorRevenueEma",
      "sectorOutputEma",
      "corpGrowthInvestmentAnchor",
    ] as const) {
      if (aggregate[key] !== undefined) row[key] = aggregate[key]! * weight;
    }
    for (const key of ["sectorRevenueSnapshots", "sectorOutputSnapshots"] as const) {
      if (aggregate[key])
        row[key] = aggregate[key]!.map((value) => ({ ...value, value: value.value * weight }));
    }
    if (aggregate.subhourBase?.growth) {
      const growth = structuredClone(aggregate.subhourBase.growth);
      growth.gdp.base *= weight;
      growth.gdp.written *= weight;
      row.subhourBase = { ...row.subhourBase, growth };
    }
    if (aggregate.conflictCapacityApplied) {
      row.conflictCapacityApplied = Object.fromEntries(
        Object.entries(aggregate.conflictCapacityApplied).map(([id, value]) => [
          `${id}:${seed._id}`,
          { destroyed: value.destroyed * weight, repaired: value.repaired * weight },
        ])
      );
    }
    return row;
  });
}
