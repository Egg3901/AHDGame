/**
 * Territorial succession assigns every existing region to exactly one successor.
 * planSuccessionTerritories conserves actual population and economic output;
 * background successors do not receive synthetic population from a new seed.
 */
export interface SuccessionRegion {
  regionId: string;
  population: number;
  annualGdpAnchor: number;
}

export interface SuccessorTerritory {
  entityId: string;
  regionIds: string[];
  population: number;
  annualGdpAnchor: number;
}

export function planSuccessionTerritories(
  regions: readonly SuccessionRegion[],
  participants: readonly string[],
  assignments: Readonly<Record<string, string>>
): SuccessorTerritory[] {
  if (
    regions.length === 0 ||
    participants.length < 2 ||
    participants.some((id) => !id.trim()) ||
    new Set(participants).size !== participants.length
  )
    throw new Error("Distinct successors and source regions are required");
  const regionIds = new Set(regions.map((region) => region.regionId));
  if (
    regionIds.size !== regions.length ||
    Object.keys(assignments).length !== regions.length ||
    Object.keys(assignments).some((id) => !regionIds.has(id))
  )
    throw new Error("Every source region must have exactly one assignment");
  const successors = new Map(
    participants.map((entityId) => [
      entityId,
      { entityId, regionIds: [] as string[], population: 0, annualGdpAnchor: 0 },
    ])
  );
  for (const region of [...regions].sort((a, b) =>
    a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0
  )) {
    if (
      !region.regionId.trim() ||
      !Number.isSafeInteger(region.population) ||
      region.population < 0 ||
      !Number.isFinite(region.annualGdpAnchor) ||
      region.annualGdpAnchor < 0
    )
      throw new Error("Source population and economic output must be valid");
    if (!Object.hasOwn(assignments, region.regionId))
      throw new Error("A source region has no successor");
    const successor = successors.get(assignments[region.regionId]);
    if (!successor) throw new Error("A region is assigned outside the settlement");
    successor.regionIds.push(region.regionId);
    successor.population += region.population;
    successor.annualGdpAnchor += region.annualGdpAnchor;
    if (!Number.isSafeInteger(successor.population) || !Number.isFinite(successor.annualGdpAnchor))
      throw new Error("Successor totals exceed supported accounting precision");
  }
  const result = [...successors.values()].sort((a, b) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0
  );
  if (result.some((successor) => successor.regionIds.length === 0 || successor.population === 0))
    throw new Error("Every successor needs an inhabited territorial base");
  return result;
}
