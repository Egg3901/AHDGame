/**
 * Relocation retains party membership only inside its live growth frontier.
 * Cross-country moves also leave the party. Callers obtain explicit consent
 * before passing the departure into performRelocation; no new join cooldown is imposed.
 */
import type { Db } from "mongodb";
import type { Character, State } from "@/lib/db/types";
import { getPartyFrontier, isInFrontier } from "@/lib/parties/partyFrontier";
import {
  getRelocationTerritory,
  PartyTerritoryError,
  PARTY_TERRITORY_WARNING,
} from "@/lib/parties/relocationTerritory";

export const PARTY_DEPARTURE_WARNING =
  "This destination is outside your party's reach. Moving will make you Independent, reset party influence, and remove party-only roles. Any existing party-join cooldown still applies; leaving does not start a new one.";

export async function relocationLeavesParty(
  db: Db,
  character: Pick<Character, "party" | "countryId" | "_id">,
  target: Pick<State, "_id" | "countryId">
): Promise<boolean> {
  if (!character.party || character.party === "independent") return false;
  const countryId = character.countryId ?? "US";
  const territory = await getRelocationTerritory(db, countryId, character.party, {
    characterId: character._id,
  });
  if (countryId !== target.countryId) {
    if (!territory.canDepart) throw new PartyTerritoryError(PARTY_TERRITORY_WARNING);
    return true;
  }
  const { presence, frontier } = await getPartyFrontier(db, countryId, character.party);
  const leaves = !isInFrontier(presence, frontier, target._id);
  if (leaves ? !territory.canDepart : !territory.canMoveTo(target._id)) {
    throw new PartyTerritoryError(PARTY_TERRITORY_WARNING);
  }
  return leaves;
}
