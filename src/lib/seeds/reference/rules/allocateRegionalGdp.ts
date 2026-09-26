/** Allocate a national nominal total by observed regional output per person. */
export function allocateRegionalGdp(
  nationalGdp: number,
  populationByRegion: Readonly<Record<string, number>>,
  outputPerPersonByRegion: Readonly<Record<string, number>>
): Record<string, number> {
  const ids = Object.keys(populationByRegion);
  if (!Number.isFinite(nationalGdp) || nationalGdp <= 0 || ids.length === 0) {
    throw new Error("Regional GDP allocation requires a positive national GDP and regions");
  }
  const weighted = ids.map((id) => {
    const population = populationByRegion[id];
    const output = outputPerPersonByRegion[id];
    if (
      !Number.isFinite(population) ||
      population <= 0 ||
      !Number.isFinite(output) ||
      output <= 0
    ) {
      throw new Error(`Missing positive population or output per person for ${id}`);
    }
    return population * output;
  });
  const totalWeight = weighted.reduce((sum, weight) => sum + weight, 0);
  const result: Record<string, number> = {};
  let assigned = 0;
  for (let i = 0; i < ids.length; i++) {
    const value =
      i === ids.length - 1
        ? nationalGdp - assigned
        : Math.round((nationalGdp * weighted[i]) / totalWeight);
    result[ids[i]] = value;
    assigned += value;
  }
  return result;
}
