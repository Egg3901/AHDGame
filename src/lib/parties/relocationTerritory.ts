/**
 * Party relocation evaluates the actual territory after the mover departs.
 * Other members and officials still preserve their footholds. The mover's
 * vacated office cannot act as a bridge: see getRelocationTerritory.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCountryRegionIds,
  getPartyPresenceStates,
  getTerritoryAdjacency,
} from "./partyFrontier";
import { preservesPartyTerritory } from "./rules/territory";

export const PARTY_TERRITORY_WARNING =
  "This move would disconnect your party's territory or expand a disconnected area without helping reconnect it. Keep another member, active NPP, or officeholder in any connecting region and expand only along a connecting path.";

export { PartyTerritoryError } from "./territoryErrors";

export async function getRelocationTerritory(
  db: Db,
  countryId: CountryId,
  partyId: string,
  departing: { characterId?: ObjectId; nppId?: ObjectId }
) {
  const regions = await getCountryRegionIds(db, countryId);
  const [before, remaining] = await Promise.all([
    getPartyPresenceStates(db, countryId, partyId, regions),
    getPartyPresenceStates(db, countryId, partyId, regions, departing),
  ]);
  const adjacency = getTerritoryAdjacency(countryId, regions);
  return {
    before,
    remaining,
    canDepart: preservesPartyTerritory(before, remaining, adjacency),
    canMoveTo: (stateId: string) =>
      preservesPartyTerritory(before, new Set([...remaining, stateId]), adjacency),
  };
}
