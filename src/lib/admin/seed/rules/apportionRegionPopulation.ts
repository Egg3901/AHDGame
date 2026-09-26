export interface RegionPopulationInput {
  id: string;
  population: number;
}

/** Preserve authored relative region weights while matching a national anchor. */
export function apportionRegionPopulation(
  regions: RegionPopulationInput[],
  nationalPopulation: number
): RegionPopulationInput[] {
  if (!Number.isSafeInteger(nationalPopulation) || nationalPopulation < 0)
    throw new Error("Invalid national population");
  const total = regions.reduce((sum, region) => sum + region.population, 0);
  if (
    total <= 0 ||
    regions.some((region) => !Number.isSafeInteger(region.population) || region.population < 0)
  )
    throw new Error("Invalid regional populations");
  const apportioned = regions.map((region) => {
    const exact = (region.population / total) * nationalPopulation;
    return { id: region.id, population: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining =
    nationalPopulation - apportioned.reduce((sum, region) => sum + region.population, 0);
  const ranked = [...apportioned].sort(
    (a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id)
  );
  for (const region of ranked) {
    if (remaining-- <= 0) break;
    region.population++;
  }
  return apportioned.map(({ id, population }) => ({ id, population }));
}
