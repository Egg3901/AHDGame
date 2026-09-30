import { ObjectId, type ClientSession, type Db } from "mongodb";
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
  let held = 0;
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
    const id = new ObjectId(resident.characterId);
    const characters = db.collection<Character>("characters");
    const character = await characters.findOne({ _id: id }, { session });
    if (
      !character ||
      character.countryId !== sourceCountryId ||
      character.homeState !== resident.homeState ||
      character.federationPendingResidenceId
    )
      throw new Error("Federation resident changed before protected relocation");
    await db.collection<FederationResidentHold>(FEDERATION_RESIDENT_HOLDS_COLLECTION).insertOne(
      {
        _id: `${applicationId}:${resident.characterId}`,
        applicationId,
        characterId: resident.characterId,
        formerCountryId: sourceCountryId,
        formerHomeState: resident.homeState,
        successorEntityId: transfer.successorEntityId,
        formerOffice: character.currentOffice ?? null,
        ...(plan.status === "selected" ? { selectedDestination: plan.destination } : {}),
      },
      { session }
    );
    const updated = await characters.updateOne(
      {
        _id: id,
        countryId: sourceCountryId,
        homeState: resident.homeState,
        federationPendingResidenceId: { $exists: false },
      },
      { $set: { federationPendingResidenceId: applicationId, currentOffice: null } },
      { session }
    );
    if (updated.matchedCount !== 1)
      throw new Error("Federation resident changed while entering protected relocation");
    await db.collection("electedOfficials").updateMany(
      { characterId: id },
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
    held++;
  }
  return held;
}
