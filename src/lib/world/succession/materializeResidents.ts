import { ObjectId, type ClientSession, type Db, type AnyBulkWriteOperation } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types/character";
import type { SuccessionResident, SuccessionResidencePlan } from "./rules/residency";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";

export const FEDERATION_RESIDENT_HOLDS_COLLECTION = "federationResidentHolds";

export interface FederationResidentHold {
  _id: string;
  applicationId: string;
  characterId: string;
  formerCountryId: CountryId;
  formerHomeState: string;
  successorEntityId: string;
  formerOffice: Character["currentOffice"];
  selectedDestination?: { countryId: CountryId; stateId: string };
}

/** Keep an affected character and every wallet intact while their choice is
 * pending. The former office is vacated because its territory is no longer a
 * playable constituency; the character is not moved without a choice. */
export async function materializeFederationResidentHolds(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  residents: readonly SuccessionResident[];
  plans: readonly SuccessionResidencePlan[];
  transfers: readonly FederationStateTransferPlan[];
  now: Date;
}): Promise<number> {
  const { db, session, applicationId, sourceCountryId, residents, plans, transfers, now } = input;
  const transferByState = new Map(transfers.map((row) => [row.stateId, row]));
  const planByCharacter = new Map(plans.map((plan) => [plan.characterId, plan]));
  if (
    !applicationId ||
    !Number.isFinite(now.getTime()) ||
    transferByState.size !== transfers.length ||
    planByCharacter.size !== plans.length ||
    new Set(residents.map((resident) => resident.characterId)).size !== residents.length ||
    plans.length !==
      residents.filter((resident) => transferByState.get(resident.homeState)?.leavesDetailedSource)
        .length
  )
    throw new Error("Federation resident hold needs a complete approved source inventory");
  const affected: Array<{ resident: SuccessionResident; plan: SuccessionResidencePlan }> = [];
  for (const resident of residents) {
    const transfer = transferByState.get(resident.homeState);
    const plan = planByCharacter.get(resident.characterId);
    if (
      !transfer ||
      transfer.topLevelRegionId !== resident.homeRegionId ||
      resident.countryId !== sourceCountryId ||
      transfer.leavesDetailedSource !== Boolean(plan) ||
      (plan &&
        (plan.successorEntityId !== transfer.successorEntityId ||
          plan.formerCountryId !== sourceCountryId ||
          plan.formerHomeState !== resident.homeState)) ||
      !/^[a-f\d]{24}$/i.test(resident.characterId)
    )
      throw new Error("Federation resident choice disagrees with live territory");
    if (!plan) continue;
    affected.push({ resident, plan });
  }
  if (affected.length === 0) return 0;
  const characters = db.collection<Character>("characters");
  const ids = affected.map(({ resident }) => new ObjectId(resident.characterId));
  const live = await characters
    .find(
      { _id: { $in: ids } },
      {
        session,
        projection: {
          countryId: 1,
          homeState: 1,
          currentOffice: 1,
          federationPendingResidenceId: 1,
        },
      }
    )
    .toArray();
  const byId = new Map(live.map((character) => [character._id.toHexString(), character]));
  const holds: FederationResidentHold[] = [];
  const updates: AnyBulkWriteOperation<Character>[] = [];
  for (const { resident, plan } of affected) {
    const id = new ObjectId(resident.characterId);
    const character = byId.get(id.toHexString());
    if (
      !character ||
      character.countryId !== sourceCountryId ||
      character.homeState !== resident.homeState ||
      Object.hasOwn(character, "federationPendingResidenceId")
    )
      throw new Error("Federation resident changed before protected relocation");
    holds.push({
      _id: `${applicationId}:${resident.characterId}`,
      applicationId,
      characterId: resident.characterId,
      formerCountryId: sourceCountryId,
      formerHomeState: resident.homeState,
      successorEntityId: plan.successorEntityId,
      formerOffice: character.currentOffice ?? null,
      ...(plan.status === "selected" ? { selectedDestination: plan.destination } : {}),
    });
    updates.push({
      updateOne: {
        filter: {
          _id: id,
          countryId: sourceCountryId,
          homeState: resident.homeState,
          federationPendingResidenceId: { $exists: false },
        },
        update: { $set: { federationPendingResidenceId: applicationId, currentOffice: null } },
      },
    });
  }
  // Validate the entire inventory before any write. All four operations share
  // the settlement transaction, so a concurrent change rolls back every hold.
  await db
    .collection<FederationResidentHold>(FEDERATION_RESIDENT_HOLDS_COLLECTION)
    .insertMany(holds, { session });
  const updated = await characters.bulkWrite(updates, { session });
  if (updated.matchedCount !== affected.length)
    throw new Error("Federation resident changed while entering protected relocation");
  await db.collection("electedOfficials").updateMany(
    { characterId: { $in: ids } },
    {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        electedAt: null,
        updatedAt: now,
      },
    },
    { session }
  );
  return affected.length;
}
