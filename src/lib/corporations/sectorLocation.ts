import { MongoServerError } from "mongodb";
import type { Filter } from "mongodb";
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

export function getCorporateSectorLaneQuery(
  sector: Pick<CorporateSector, "sectorType" | "industryModel" | "mediaDiscriminator">
): Filter<CorporateSector> {
  if (sector.sectorType === "entertainment" || sector.mediaDiscriminator === "entertainment") {
    return {
      $or: [
        { sectorType: "media", industryModel: null, mediaDiscriminator: "entertainment" },
        { sectorType: "entertainment", industryModel: null },
      ],
    };
  }
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
  const legacyEntertainment = sector.sectorType === "entertainment";
  return [
    sector.corporationId.toString(),
    getSectorOperatingCountryId(sector, stateCountryByStateId),
    sector.stateId,
    legacyEntertainment ? "media" : sector.sectorType,
    legacyEntertainment ? "" : (sector.industryModel ?? ""),
    legacyEntertainment ? "entertainment" : (sector.mediaDiscriminator ?? ""),
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
