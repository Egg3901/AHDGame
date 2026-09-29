import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { State } from "@/lib/db/types/state";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { SuccessionCustodyAsset } from "./rules/custody";
import type { SuccessionRegion } from "./rules/territory";

export interface LiveSuccessionInventory {
  sourceRegions: SuccessionRegion[];
  custodyAssets: SuccessionCustodyAsset[];
}

/** Read the actual detailed source before a proposed territorial partition.
 * This read must share the settlement transaction's snapshot when used to apply
 * a settlement. Missing physical locations stay unassigned for negotiation;
 * neither a corporate book value nor military equipment value is invented. */
export async function loadLiveSuccessionInventory(
  db: Db,
  sourceCountryId: CountryId,
  session?: ClientSession
): Promise<LiveSuccessionInventory> {
  const states = await db
    .collection<State>("states")
    .find({ countryId: sourceCountryId }, { session })
    .toArray();
  const topLevel = states.filter((state) => !state.parentRegionId);
  if (
    topLevel.length === 0 ||
    topLevel.some(
      (state) =>
        !state._id.trim() ||
        !Number.isSafeInteger(state.population) ||
        state.population < 0 ||
        !Number.isFinite(state.gdp) ||
        state.gdp < 0
    )
  )
    throw new Error("Live federation regions are missing or invalid");
  const regionIds = new Set(topLevel.map((state) => state._id));
  if (regionIds.size !== topLevel.length)
    throw new Error("Live federation contains duplicate region identities");
  const stateById = new Map(states.map((state) => [state._id, state]));
  if (stateById.size !== states.length)
    throw new Error("Live federation contains duplicate region identities");
  const topLevelFor = (stateId: string | null | undefined): string | null => {
    if (!stateId) return null;
    const visited = new Set<string>();
    let current: string | undefined = stateId;
    while (current) {
      const state = stateById.get(current);
      if (!state) return null;
      if (visited.has(current))
        throw new Error("Live federation region hierarchy contains a cycle");
      visited.add(current);
      if (!state.parentRegionId) return state._id;
      current = state.parentRegionId;
    }
    return null;
  };
  for (const state of states) {
    if (topLevelFor(state._id) === null)
      throw new Error("Live federation region hierarchy has a missing parent");
  }

  const corporations = await db
    .collection<Corporation>("corporations")
    .find(
      {
        $or: [
          { countryOwnerId: sourceCountryId },
          { countryId: sourceCountryId, ownershipState: "stateOwned" },
        ],
      },
      { session }
    )
    .toArray();
  const publicCorporationIds = corporations
    .filter(
      (corp) => isStateOwned(corp) && (corp.countryOwnerId ?? corp.countryId) === sourceCountryId
    )
    .map((corp) => corp._id);
  const sectors = publicCorporationIds.length
    ? await db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: { $in: publicCorporationIds } }, { session })
        .toArray()
    : [];
  const units = await db
    .collection<MilitaryUnit>("militaryUnits")
    .find({ countryId: sourceCountryId }, { session })
    .toArray();
  return {
    sourceRegions: topLevel
      .map((state) => ({
        regionId: state._id,
        population: state.population,
        annualGdpAnchor: state.gdp,
      }))
      .sort((a, b) => a.regionId.localeCompare(b.regionId)),
    custodyAssets: [
      ...sectors.map((sector) => ({
        assetId: `enterprise:${sector._id.toString()}`,
        kind: "public-enterprise" as const,
        homeRegionId: topLevelFor(sector.stateId),
      })),
      ...units.map((unit) => ({
        assetId: `force:${unit._id.toString()}`,
        kind: (unit.domain === "rocket" || unit.domain === "space"
          ? "strategic-force"
          : "conventional-force") as SuccessionCustodyAsset["kind"],
        homeRegionId: topLevelFor(unit.station),
      })),
    ].sort((a, b) => a.assetId.localeCompare(b.assetId)),
  };
}
