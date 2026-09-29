import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { State } from "@/lib/db/types/state";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { sectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import type { PrivateSuccessionFirm } from "./rules/privateFacilities";
import { buildSourceRegionHierarchy } from "./sourceRegionHierarchy";

/** Snapshot the current private corporations and paid facility basis. The
 * settlement writer must refresh this before applying any claim. */
export async function loadLivePrivateSuccessionFirms(
  db: Db,
  sourceCountryId: CountryId,
  currentYear: number,
  eraUnitScale: number,
  session?: ClientSession
): Promise<PrivateSuccessionFirm[]> {
  if (!Number.isFinite(currentYear) || !Number.isFinite(eraUnitScale) || eraUnitScale <= 0)
    throw new Error("Private firm inventory needs a valid era valuation basis");
  const states = await db
    .collection<State>("states")
    .find({ countryId: sourceCountryId }, { session })
    .toArray();
  const { topLevelFor } = buildSourceRegionHierarchy(states);
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ countryId: sourceCountryId }, { session })
    .toArray();
  const privateCorporations = corporations.filter((corp) => !isStateOwned(corp));
  const sectors = privateCorporations.length
    ? await db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: { $in: privateCorporations.map((corp) => corp._id) } }, { session })
        .toArray()
    : [];
  const byCorporation = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    if (sector.countryId !== sourceCountryId) continue;
    const id = sector.corporationId.toString();
    byCorporation.set(id, [...(byCorporation.get(id) ?? []), sector]);
  }
  return privateCorporations
    .map((corp) => {
      const headquartersRegionId = topLevelFor(corp.headquartersState);
      if (!headquartersRegionId)
        throw new Error("Private firm headquarters is outside the source federation");
      return {
        corporationId: corp._id.toString(),
        countryId: corp.countryId,
        headquartersState: corp.headquartersState,
        headquartersRegionId,
        facilities: (byCorporation.get(corp._id.toString()) ?? []).map((sector) => {
          const regionId = topLevelFor(sector.stateId);
          if (!regionId) throw new Error("Private facility is outside the source federation");
          const bookValueAnchor = sectorBookValueAnchor(sector, currentYear, eraUnitScale);
          if (!Number.isFinite(bookValueAnchor) || bookValueAnchor < 0)
            throw new Error("Private facility has an invalid book value");
          return { sectorId: sector._id.toString(), regionId, bookValueAnchor };
        }),
      };
    })
    .sort((a, b) => a.corporationId.localeCompare(b.corporationId));
}
