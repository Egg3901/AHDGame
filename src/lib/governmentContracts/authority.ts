/** Tender management follows the existing defence seat and extraction licensing authorities, including successors in office. */
import type { Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { getResourceContractAuthority } from "@/lib/extraction/contractAuthority";
import { isNationalIssuer, isStateIssuer } from "@/lib/extraction/contractIssuerAuth";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import type { CountryId } from "@/lib/constants/countries";
import type { TenderTerms } from "./types";

export async function managementAuthority(
  db: Db,
  countryId: CountryId,
  terms: TenderTerms,
  user: AuthUserWithCharacter,
  requiredLevel?: "national" | "state"
): Promise<"national" | "state" | null> {
  if (user.isAdmin && (requiredLevel || terms.type === "defence"))
    return requiredLevel ?? "national";
  const character = user.character;
  if (!character && !user.isAdmin) return null;
  if (terms.type === "defence") {
    if (!character) return null;
    const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId];
    if (!positionId) return null;
    const member = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId,
      characterId: character._id,
    });
    return member && !requireConfirmedSecretary(member, "procurement") ? "national" : null;
  }
  const law = await getResourceContractAuthority(db, countryId);
  if (user.isAdmin) return law === "state" ? "state" : "national";
  if (!character) return null;
  if (
    requiredLevel !== "state" &&
    law !== "state" &&
    (await isNationalIssuer(db, countryId, character._id))
  )
    return "national";
  if (
    requiredLevel !== "national" &&
    law !== "national" &&
    (await isStateIssuer(db, countryId, terms.stateId, character._id))
  )
    return "state";
  return null;
}
