/**
 * Bilateral migration pairs actual origin outflows with destination demand.
 * planBilateralMigration honors enacted corridors and their capacity while
 * leaving unmatched flows for the existing rest-of-world calculation.
 */
export interface MigrationDemand {
  regionId: string;
  countryId: string;
  netPeople: number;
}

export interface MigrationCorridor {
  originCountryId: string;
  destinationCountryId: string;
  /** Maximum modeled people moved per turn under this agreement. */
  capacityPeople: number;
}

export interface MigrationRoute {
  originRegionId: string;
  destinationRegionId: string;
  originCountryId: string;
  destinationCountryId: string;
  people: number;
}

export interface BilateralMigrationPlan {
  routes: MigrationRoute[];
  /** Remaining signed net requests, still subject to the rest-of-world cap. */
  unmatchedByRegion: Record<string, number>;
}

/** Pair counterpart demand once, with deterministic ordering and no invented residents. */
export function planBilateralMigration(
  demands: readonly MigrationDemand[],
  corridors: readonly MigrationCorridor[]
): BilateralMigrationPlan {
  const ids = new Set<string>();
  const remaining = new Map<string, number>();
  const regions = new Map<string, MigrationDemand>();
  for (const demand of demands) {
    if (
      !demand.regionId.trim() ||
      !demand.countryId.trim() ||
      ids.has(demand.regionId) ||
      !Number.isFinite(demand.netPeople)
    )
      throw new Error("Migration demand needs distinct regions and finite people");
    ids.add(demand.regionId);
    remaining.set(demand.regionId, demand.netPeople);
    regions.set(demand.regionId, demand);
  }
  const allowed = new Map<string, number>();
  for (const corridor of corridors) {
    if (
      !corridor.originCountryId.trim() ||
      !corridor.destinationCountryId.trim() ||
      corridor.originCountryId === corridor.destinationCountryId ||
      !Number.isFinite(corridor.capacityPeople) ||
      corridor.capacityPeople < 0
    )
      throw new Error("Migration corridor must connect distinct countries with valid capacity");
    const key = `${corridor.originCountryId}:${corridor.destinationCountryId}`;
    if (allowed.has(key)) throw new Error("Duplicate migration corridor");
    allowed.set(key, corridor.capacityPeople);
  }
  const routes: MigrationRoute[] = [];
  const origins = [...demands]
    .filter((d) => d.netPeople < 0)
    .sort((a, b) => a.regionId.localeCompare(b.regionId));
  const destinations = [...demands]
    .filter((d) => d.netPeople > 0)
    .sort((a, b) => a.regionId.localeCompare(b.regionId));
  for (const origin of origins) {
    for (const destination of destinations) {
      const key = `${origin.countryId}:${destination.countryId}`;
      const capacity = allowed.get(key) ?? 0;
      const people = Math.min(
        -(remaining.get(origin.regionId) ?? 0),
        remaining.get(destination.regionId) ?? 0,
        capacity
      );
      if (people <= 0) continue;
      routes.push({
        originRegionId: origin.regionId,
        destinationRegionId: destination.regionId,
        originCountryId: origin.countryId,
        destinationCountryId: destination.countryId,
        people,
      });
      remaining.set(origin.regionId, remaining.get(origin.regionId)! + people);
      remaining.set(destination.regionId, remaining.get(destination.regionId)! - people);
      allowed.set(key, capacity - people);
    }
  }
  return {
    routes,
    unmatchedByRegion: Object.fromEntries(
      [...regions.keys()].sort().map((id) => [id, remaining.get(id)!])
    ),
  };
}

/** Move the same age and sex cells from source to host, clamped by source stock. */
export function transferBilateralCohorts(
  origin: { male: readonly number[]; female: readonly number[] },
  destination: { male: readonly number[]; female: readonly number[] },
  requestedPeople: number,
  profile: { male: readonly number[]; female: readonly number[] }
) {
  if (!Number.isFinite(requestedPeople) || requestedPeople < 0)
    throw new Error("Bilateral transfer must request a non-negative finite population");
  const profileTotal = [...profile.male, ...profile.female].reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(profileTotal) || profileTotal > 1 + 1e-9)
    throw new Error("Bilateral transfer profile exceeds the requested population");
  const from = { male: [...origin.male], female: [...origin.female] };
  const to = { male: [...destination.male], female: [...destination.female] };
  let moved = 0;
  for (const sex of ["male", "female"] as const) {
    if (from[sex].length !== to[sex].length || from[sex].length !== profile[sex].length)
      throw new Error("Bilateral cohort vectors must align");
    for (let age = 0; age < from[sex].length; age++) {
      const available = from[sex][age];
      const weight = profile[sex][age];
      if (
        !Number.isFinite(available) ||
        available < 0 ||
        !Number.isFinite(to[sex][age]) ||
        to[sex][age] < 0 ||
        !Number.isFinite(weight) ||
        weight < 0
      )
        throw new Error("Bilateral cohort cells must be finite and non-negative");
      const count = Math.min(available, requestedPeople * weight);
      from[sex][age] -= count;
      to[sex][age] += count;
      moved += count;
    }
  }
  return { origin: from, destination: to, moved };
}
