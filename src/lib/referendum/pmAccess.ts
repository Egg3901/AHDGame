import type { Db, ObjectId } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

/** Human PMs act personally. An NPP PM's party chair/vice-chair may act for it. */
export async function canDecideReferendum(db: Db, characterId: ObjectId): Promise<boolean> {
  const pmId = await getHeadOfGovernmentCharacterId(db, "UK");
  if (pmId) return pmId.equals(characterId);
  const ministry = await getGovernmentFormationsCollection(db).findOne({ _id: "UK" });
  if (
    !ministry ||
    ministry.status !== "formed" ||
    !ministry.pmNppId ||
    ministry.pmCharacterId ||
    !ministry.governingPartyId
  )
    return false;
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { countryId: "UK", sequentialId: Number(ministry.governingPartyId) },
      { projection: { chairId: 1, viceChairId: 1 } }
    );
  return (
    party?.chairId?.equals(characterId) === true || party?.viceChairId?.equals(characterId) === true
  );
}
