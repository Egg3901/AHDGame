import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types/character";
import type { State } from "@/lib/db/types/state";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";
import {
  FEDERATION_RESIDENT_HOLDS_COLLECTION,
  type FederationResidentHold,
} from "./materializeResidents";
import {
  FEDERATION_RELOCATIONS_COLLECTION,
  type FederationRelocationRecord,
} from "./relocationLedger";

export interface FederationResidentDestination {
  countryId: CountryId;
  stateId: string;
}

/** Complete a protected residence choice within the caller's transaction. */
export async function chooseFederationResidentHome(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  characterId: string;
  ownerUserId: string;
  destination: FederationResidentDestination;
}): Promise<FederationResidentHold> {
  const { db, session, applicationId, characterId, ownerUserId, destination } = input;
  if (!applicationId || !/^[a-f\d]{24}$/i.test(characterId) || !ownerUserId || !destination.stateId)
    throw new Error("Federation residence choice needs a character, owner and destination");
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied" }, { session });
  if (!application) throw new Error("Federation residence choice awaits settlement");
  const state = await db
    .collection<State>("states")
    .findOne({ _id: destination.stateId, countryId: destination.countryId }, { session });
  const access = await getCountryAccessFromDb(db, destination.countryId);
  if (!state || !access.enabledForPlayers || !access.registered)
    throw new Error("Federation residence destination is not playable");
  const holds = db.collection<FederationResidentHold>(FEDERATION_RESIDENT_HOLDS_COLLECTION);
  const holdId = `${applicationId}:${characterId}`;
  const hold = await holds.findOne({ _id: holdId }, { session });
  const characters = db.collection<Character>("characters");
  const character = await characters.findOne({ _id: new ObjectId(characterId) }, { session });
  if (!hold || !character || character.userId.toString() !== ownerUserId)
    throw new Error("Federation residence choice is not owned or pending");
  if (
    hold.selectedDestination &&
    (hold.selectedDestination.countryId !== destination.countryId ||
      hold.selectedDestination.stateId !== destination.stateId)
  )
    throw new Error("Federation residence choice conflicts with an earlier choice");
  const relocations = db.collection<FederationRelocationRecord>(FEDERATION_RELOCATIONS_COLLECTION);
  const relocationId = `${applicationId}:resident:${characterId}`;
  const relocation = await relocations.findOne({ _id: relocationId }, { session });
  if (
    !relocation ||
    relocation.kind !== "resident" ||
    relocation.subjectId !== characterId ||
    (relocation.destination &&
      (relocation.destination.countryId !== destination.countryId ||
        relocation.destination.stateId !== destination.stateId))
  )
    throw new Error("Federation resident relocation record is missing or conflicted");
  if (character.federationPendingResidenceId === applicationId) {
    if (
      character.countryId !== hold.formerCountryId ||
      character.homeState !== hold.formerHomeState
    )
      throw new Error("Federation resident changed before choosing a new home");
    const moved = await characters.updateOne(
      {
        _id: character._id,
        federationPendingResidenceId: applicationId,
        countryId: hold.formerCountryId,
        homeState: hold.formerHomeState,
      },
      {
        $set: { countryId: destination.countryId, homeState: destination.stateId },
        $unset: { federationPendingResidenceId: "" },
      },
      { session }
    );
    if (moved.matchedCount !== 1) throw new Error("Federation resident changed during choice");
  } else if (
    character.federationPendingResidenceId != null ||
    character.countryId !== destination.countryId ||
    character.homeState !== destination.stateId
  ) {
    throw new Error("Federation residence choice is not owned or pending");
  }
  await relocations.updateOne(
    { _id: relocationId },
    { $set: { status: "selected", destination } },
    { session }
  );
  await holds.updateOne(
    { _id: holdId },
    { $set: { selectedDestination: destination } },
    { session }
  );
  const completed = await holds.findOne({ _id: holdId }, { session });
  if (!completed) throw new Error("Federation residence choice was not recorded");
  return completed;
}
