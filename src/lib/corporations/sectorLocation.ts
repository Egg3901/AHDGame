import { MongoServerError } from "mongodb";
import type { CorporateSector, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export function buildSectorStateCountryMap(
  states: Pick<State, "_id" | "countryId">[]
): Map<string, CountryId> {
  return new Map(states.map((state) => [String(state._id), state.countryId]));
}

export function getSectorOperatingCountryId(
  sector: Pick<CorporateSector, "stateId" | "countryId">,
  stateCountryByStateId: ReadonlyMap<string, CountryId>
): CountryId {
  return stateCountryByStateId.get(sector.stateId) ?? sector.countryId;
}

/** Lane criteria apply to owned sectors and their unowned market buckets. */
export type SectorLaneQuery = Pick<CorporateSector, "sectorType"> & {
  industryModel: CorporateSector["industryModel"] | null;
  mediaDiscriminator: CorporateSector["mediaDiscriminator"] | null;
};

export function getCorporateSectorLaneQuery(
  sector: Pick<CorporateSector, "sectorType" | "industryModel" | "mediaDiscriminator">
): SectorLaneQuery {
  return {
    sectorType: sector.sectorType,
    industryModel: sector.industryModel ?? null,
    mediaDiscriminator: sector.mediaDiscriminator ?? null,
  };
}

export function getCorporateSectorLocationKey(
  sector: Pick<
    CorporateSector,
    | "corporationId"
    | "stateId"
    | "sectorType"
    | "industryModel"
    | "mediaDiscriminator"
    | "countryId"
  >,
  stateCountryByStateId: ReadonlyMap<string, CountryId>
): string {
  return [
    sector.corporationId.toString(),
    getSectorOperatingCountryId(sector, stateCountryByStateId),
    sector.stateId,
    sector.sectorType,
    sector.industryModel ?? "",
    sector.mediaDiscriminator ?? "",
  ].join(":");
}

export function isCorporateSectorDuplicateKey(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    (!!error.keyPattern?.corporationId ||
      /\bcorporationId_1_stateId_1_sectorType_1(?:_industryModel_1)?(?:_mediaDiscriminator_1)?\b/.test(
        error.message
      ) ||
      /\bcorporateSectors_corporationId_stateId_sectorType(?:_industryModel)?(?:_mediaDiscriminator)?\b/.test(
        error.message
      ))
  );
}
