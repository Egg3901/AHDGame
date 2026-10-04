/** Resolve the sitting leader for accountability without conflating NPPs with players. */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "./headOfGovernment";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { governmentLeaderReference, type LeaderReference } from "@/lib/government/leaderReference";

export async function getHeadOfGovernmentReference(
  db: Db,
  countryId: CountryId
): Promise<LeaderReference | null> {
  const characterId = await getHeadOfGovernmentCharacterId(db, countryId);
  if (characterId) return characterId;
  return governmentLeaderReference(
    await getGovernmentFormationsCollection(db).findOne({ _id: countryId })
  );
}
