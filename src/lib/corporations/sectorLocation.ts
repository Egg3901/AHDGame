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

export function getCorporateSectorLocationKey(
  sector: Pick<CorporateSector, "corporationId" | "stateId" | "sectorType" | "countryId">,
  stateCountryByStateId: ReadonlyMap<string, CountryId>
): string {
  return [
    sector.corporationId.toString(),
    getSectorOperatingCountryId(sector, stateCountryByStateId),
    sector.stateId,
    sector.sectorType,
  ].join(":");
}

export function isCorporateSectorDuplicateKey(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000 &&
    (!!error.keyPattern?.corporationId ||
      /\bcorporationId_1_stateId_1_sectorType_1\b/.test(error.message) ||
      /\bcorporateSectors_corporationId_stateId_sectorType\b/.test(error.message))
  );
}
