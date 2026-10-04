import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { State } from "@/lib/db/types/state";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { SuccessionCustodyAsset } from "./rules/custody";
import type { SuccessionRegion } from "./rules/territory";
import { buildSourceRegionHierarchy } from "./sourceRegionHierarchy";

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
  const { topLevel, topLevelFor } = buildSourceRegionHierarchy(states);

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
  const corporationsWithSites = new Set(sectors.map((sector) => sector.corporationId.toString()));
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
      ...publicCorporationIds
        .filter((id) => !corporationsWithSites.has(id.toString()))
        .map((id) => ({
          assetId: `enterprise-shell:${id.toString()}`,
          kind: "public-enterprise" as const,
          homeRegionId: null,
        })),
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
