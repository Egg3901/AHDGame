/**
 * Complete federation dissolution retires offices, cabinet posts and pending votes.
 * materializeFederationFederalRetirement archives their history and clears office
 * links in the settlement transaction, preserving residents and their accounts.
 */
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Character,
  CountryGameState,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  NPP,
} from "@/lib/db/types";
import { FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION } from "./materializeRussianCongress";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";

type HistoricalPoliticalRow = { _id: ObjectId | string; [key: string]: unknown };

export async function materializeFederationFederalRetirement(input: {
  db: Db;
  session: ClientSession;
  sourceCountryId: CountryId;
  applicationId: string;
  appliedOnTurn: number;
  now: Date;
}): Promise<{ cancelledElections: number; vacatedOffices: number }> {
  const { db, session, sourceCountryId, applicationId, appliedOnTurn, now } = input;
  if (
    !session.inTransaction() ||
    !applicationId ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Federation retirement needs a transaction, application, turn and time");
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: sourceCountryId, dissolvedTurn: null }, { session });
  if (!country) throw new Error("Federation source country changed before dissolution");
  // Keep historical offices and cabinet memberships before vacating the source.
  // Each collection is read once and archived in the existing settlement ledger.
  for (const collectionName of ["electedOfficials", "cabinetMembers", "governmentFormations"]) {
    const filter =
      collectionName === "governmentFormations"
        ? { _id: sourceCountryId }
        : { countryId: sourceCountryId };
    const rows = await db
      .collection<HistoricalPoliticalRow>(collectionName)
      .find(filter, { session })
      .toArray();
    if (rows.length)
      await db
        .collection<{
          _id: string;
          applicationId: string;
          sourceCountryId: CountryId;
          value: HistoricalPoliticalRow;
        }>(FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION)
        .insertMany(
          rows.map((value) => ({
            _id: `${applicationId}:${collectionName}:${value._id.toString()}`,
            applicationId,
            sourceCountryId,
            value,
          })),
          { session }
        );
  }
  const activeElectionIds = await db
    .collection<Election>("elections")
    .find(
      { countryId: sourceCountryId, status: { $in: ["upcoming", "active"] } },
      { session, projection: { _id: 1 } }
    )
    .toArray();
  if (activeElectionIds.length)
    await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      {
        electionId: { $in: activeElectionIds.map((election) => election._id) },
        status: "active",
      },
      { $set: { status: "withdrawn", updatedAt: now } },
      { session }
    );
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId: sourceCountryId, currentOffice: { $ne: null } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: sourceCountryId, currentOffice: { $ne: null } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  for (const collectionName of ["pmAppointmentVotes", "noConfidenceVotes"])
    await db
      .collection(collectionName)
      .updateMany(
        { countryId: sourceCountryId, status: "active" },
        { $set: { status: "cancelled", closedAt: now, updatedAt: now } },
        { session }
      );
  await db.collection("cabinetMembers").deleteMany({ countryId: sourceCountryId }, { session });
  await db.collection("ukCabinetCooldowns").deleteMany({ countryId: sourceCountryId }, { session });
  const elections = await db
    .collection<Election>("elections")
    .updateMany(
      { countryId: sourceCountryId, status: { $in: ["upcoming", "active"] } },
      { $set: { status: "cancelled", updatedAt: now } },
      { session }
    );
  const offices = await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ countryId: sourceCountryId }, { session });
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: sourceCountryId },
    {
      $set: {
        status: "collapsed",
        collapsedAt: now,
        pmCharacterId: null,
        pmNppId: null,
        pmName: null,
        hosCharacterId: null,
        hosNppId: null,
        hosName: null,
        presidentNppId: null,
        presidentName: null,
        governingPartyId: null,
        coalitionId: null,
        coalitionPartyIds: null,
        formationType: null,
        seatsByParty: {},
        totalSeats: 0,
        totalSeatsSupporting: 0,
        majorityThreshold: 1,
        activeVoteId: null,
        formedAt: null,
        formedTurn: null,
        pmVacancyDeadlineTurn: null,
        pmAppointmentNominationLockId: null,
        pmAppointmentNominationLockExpiresAt: null,
        governingAgenda: null,
        fiscalStance: null,
        commandStance: null,
        governingGoals: null,
        ministerialReshuffle: null,
        updatedAt: now,
      },
    },
    { session }
  );
  const updated = await db.collection<CountryGameState>("countryGameStates").updateOne(
    { _id: sourceCountryId, dissolvedTurn: null },
    {
      $set: {
        dissolvedTurn: appliedOnTurn,
        updatedAt: now,
        ...(sourceCountryId === "YU" ? { yuSettlementAppliedSinceTurn: appliedOnTurn } : {}),
      },
    },
    { session }
  );
  if (updated.matchedCount !== 1)
    throw new Error("Federation source country changed during dissolution");
  return { cancelledElections: elections.modifiedCount, vacatedOffices: offices.deletedCount };
}
