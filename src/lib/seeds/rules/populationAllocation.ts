/**
 * Regional population estimates share one national total. allocatePopulationTotal
 * preserves the supplied regional shares and assigns whole people by largest remainder,
 * so the regional sum matches its dated national anchor without changing other fields.
 */
export function allocatePopulationTotal<T extends { _id: string; population: number }>(
  regions: readonly T[],
  nationalTotal: number
): T[] {
  if (!Number.isSafeInteger(nationalTotal) || nationalTotal <= 0 || regions.length === 0) {
    throw new Error("Population allocation needs a positive integer total and nonempty regions.");
  }
  const seen = new Set<string>();
  for (const region of regions) {
    if (
      seen.has(region._id) ||
      !Number.isSafeInteger(region.population) ||
      region.population <= 0
    ) {
      throw new Error("Population allocation needs unique ids and positive integer weights.");
    }
    seen.add(region._id);
  }
  const weightTotal = regions.reduce((sum, region) => sum + region.population, 0);
  if (!Number.isSafeInteger(weightTotal))
    throw new Error("Population weights exceed safe integer range.");
  const shares = regions.map((region, index) => {
    const exact = (region.population / weightTotal) * nationalTotal;
    return {
      index,
      id: region._id,
      floor: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  const remaining = nationalTotal - shares.reduce((sum, share) => sum + share.floor, 0);
  if (remaining < 0 || remaining > regions.length)
    throw new Error("Population allocation lost precision.");
  const ranked = [...shares].sort(
    (a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (let index = 0; index < remaining; index++) ranked[index].floor++;
  return regions.map((region, index) => ({ ...region, population: shares[index].floor }));
}
