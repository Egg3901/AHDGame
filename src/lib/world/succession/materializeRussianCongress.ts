/**
 * Ratified Soviet succession preserves retained deputies as a provisional
 * Russian Congress, retires Union political mandates and reopens ordinary
 * government formation in the same transaction as the territorial settlement.
 */
import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  ElectedOfficial,
  Election,
  NPP,
  State,
} from "@/lib/db/types";
import type { CountryState } from "@/lib/db/types/countryState";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { invalidateCachedCountryState } from "@/lib/countryState/cache";
import { PM_VACANCY_DEADLINE_TURNS } from "@/lib/constants/turnTime";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";
import { planProvisionalRussianCongress } from "./rules/provisionalCongress";

export const FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION = "federationArchivedPoliticalRows";
const UNION_OFFICES = ["unionCongressDeputy", "chairmanOfCabinet", "sovietPresident"];
const FEDERAL_PERSON_OFFICES = [...UNION_OFFICES, "parliamentaryCabinet"];

export async function materializeProvisionalRussianCongress(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  transfers: readonly FederationStateTransferPlan[];
  appliedOnTurn: number;
  now: Date;
}) {
  const { db, session, applicationId, transfers, appliedOnTurn, now } = input;
  const retainedStateIds = transfers
    .filter((row) => !row.leavesDetailedSource)
    .map((row) => row.stateId);
  if (
    !session.inTransaction() ||
    !applicationId ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !Number.isFinite(now.getTime()) ||
    transfers.length === 0 ||
    new Set(transfers.map((row) => row.stateId)).size !== transfers.length ||
    retainedStateIds.length === 0 ||
    transfers.some((row) => row.leavesDetailedSource !== (row.successorEntityId !== "RU"))
  ) {
    throw new Error(
      "Russian political succession needs a transaction and approved retained territory"
    );
  }
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruPresidencySinceTurn: 1,
        ruCongressDissolvedSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (!country || country.ruSovietSuccessionSinceTurn != null)
    throw new Error("Russian political succession has already been applied or has no source state");
  const establishedConstitution =
    country.ruPresidencySinceTurn != null ||
    country.ruCongressDissolvedSinceTurn != null ||
    country.ruFederalAssemblySinceTurn != null;
  const runtime = await db
    .collection<CountryState>("countryState")
    .findOne({ _id: "RU" }, { session, projection: { _id: 1 } });
  if (!runtime) throw new Error("Russian succession requires its existing runtime country state");
  const states = await db
    .collection<State>("states")
    .find(
      { countryId: "RU", _id: { $in: retainedStateIds } },
      { session, projection: { houseDistricts: 1 } }
    )
    .toArray();
  if (states.length !== retainedStateIds.length)
    throw new Error("Retained Russian territory changed during political succession");
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: "RU" }, { session })
    .toArray();
  if (establishedConstitution) {
    return preserveEstablishedRussianConstitution({
      ...input,
      country,
      officials,
      retainedStateIds,
    });
  }
  if (officials.some((row) => !UNION_OFFICES.includes(row.officeType)))
    throw new Error("Unexpected Russian offices require an explicit institutional settlement");
  const plan = planProvisionalRussianCongress(
    states.map((state) => ({ stateId: state._id, seats: state.houseDistricts ?? 0 })),
    officials.map((row) => ({
      id: row._id.toHexString(),
      officeType: row.officeType,
      stateId: row.state,
      party: row.party,
      seatsHeld: row.seatsHeld,
      characterId: row.characterId?.toHexString(),
      nppId: row.nppId?.toHexString(),
    }))
  );
  // Verify every retained holder before any write, using two projected reads.
  const playerIds = plan.retained.flatMap((row) =>
    row.characterId ? [new ObjectId(row.characterId)] : []
  );
  const nppIds = plan.retained.flatMap((row) =>
    !row.characterId && row.nppId ? [new ObjectId(row.nppId)] : []
  );
  const players = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: playerIds },
            countryId: "RU",
            federationPendingResidenceId: { $exists: false },
          },
          { session, projection: { _id: 1 } }
        )
        .toArray()
    : [];
  const npps = nppIds.length
    ? await db
        .collection<NPP>("npps")
        .find({ _id: { $in: nppIds }, countryId: "RU" }, { session, projection: { _id: 1 } })
        .toArray()
    : [];
  if (
    players.length !== new Set(playerIds.map(String)).size ||
    npps.length !== new Set(nppIds.map(String)).size
  )
    throw new Error("A retained deputy is missing or awaiting residence choice");
  const archive = db.collection<{
    _id: string;
    applicationId: string;
    sourceCountryId: string;
    value: ElectedOfficial;
  }>(FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION);
  if (officials.length)
    await archive.insertMany(
      officials.map((value) => ({
        _id: `${applicationId}:electedOfficials:${value._id.toHexString()}`,
        applicationId,
        sourceCountryId: "RU",
        value,
      })),
      { session }
    );
  // Clear office links in batches; personal wealth and residence never change.
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId: "RU", "currentOffice.type": { $in: FEDERAL_PERSON_OFFICES } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: "RU", "currentOffice.type": { $in: FEDERAL_PERSON_OFFICES } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  const characterUpdates: AnyBulkWriteOperation<Character>[] = [];
  const nppUpdates: AnyBulkWriteOperation<NPP>[] = [];
  for (const deputy of plan.retained) {
    const currentOffice = {
      type: "congressDeputy",
      state: deputy.stateId,
      seatsHeld: deputy.seatsHeld ?? 1,
    };
    if (deputy.characterId)
      characterUpdates.push({
        updateOne: {
          filter: {
            _id: new ObjectId(deputy.characterId),
            countryId: "RU",
            federationPendingResidenceId: { $exists: false },
          },
          update: { $set: { currentOffice, updatedAt: now } },
        },
      });
    else if (deputy.nppId)
      nppUpdates.push({
        updateOne: {
          filter: { _id: new ObjectId(deputy.nppId), countryId: "RU" },
          update: { $set: { currentOffice, updatedAt: now } },
        },
      });
  }
  if (characterUpdates.length) {
    const result = await db
      .collection<Character>("characters")
      .bulkWrite(characterUpdates, { session });
    if (result.matchedCount !== characterUpdates.length)
      throw new Error("A retained player deputy is missing or awaiting residence choice");
  }
  if (nppUpdates.length) {
    const result = await db.collection<NPP>("npps").bulkWrite(nppUpdates, { session });
    if (result.matchedCount !== nppUpdates.length)
      throw new Error("A retained NPC deputy is missing");
  }
  const seats = db.collection<ElectedOfficial>("electedOfficials");
  if (plan.retired.length)
    await seats.deleteMany(
      { countryId: "RU", _id: { $in: plan.retired.map((row) => new ObjectId(row.id)) } },
      { session }
    );
  if (plan.retained.length)
    await seats.updateMany(
      { countryId: "RU", _id: { $in: plan.retained.map((row) => new ObjectId(row.id)) } },
      { $set: { officeType: "congressDeputy", updatedAt: now } },
      { session }
    );
  await db
    .collection<Election>("elections")
    .updateMany(
      { countryId: "RU", status: { $in: ["upcoming", "active"] } },
      { $set: { status: "cancelled", updatedAt: now } },
      { session }
    );
  for (const collection of ["pmAppointmentVotes", "noConfidenceVotes"])
    await db
      .collection(collection)
      .updateMany(
        { countryId: "RU", status: "active" },
        { $set: { status: "cancelled", closedAt: now, updatedAt: now } },
        { session }
      );
  await db.collection("cabinetMembers").deleteMany({ countryId: "RU" }, { session });
  await db.collection("ukCabinetCooldowns").deleteMany({ countryId: "RU" }, { session });
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "RU" },
    {
      $set: {
        countryId: "RU",
        status: "pending",
        formationType: null,
        lostMajority: false,
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
        totalSeatsSupporting: 0,
        majorityThreshold: plan.majorityThreshold,
        seatsByParty: plan.seatsByParty,
        totalSeats: plan.totalSeats,
        activeVoteId: null,
        formedAt: null,
        formedTurn: null,
        collapsedAt: now,
        pmVacancyDeadlineTurn: appliedOnTurn + PM_VACANCY_DEADLINE_TURNS,
        pmAppointmentNominationLockId: null,
        pmAppointmentNominationLockExpiresAt: null,
        governingAgenda: null,
        fiscalStance: null,
        commandStance: null,
        updatedAt: now,
      },
      $setOnInsert: { _id: "RU", cycle: 1, createdAt: now },
    },
    { session, upsert: true }
  );
  const runtimeChanged = await db.collection<CountryState>("countryState").updateOne(
    { _id: "RU" },
    {
      $set: {
        governmentType: "parliamentaryRepublic",
        rulingPartyId: null,
        opsVoteMultipliers: null,
        hasLeaderConfidenceModel: false,
        displayNameOverride: "Russia",
        flagEmojiOverride: "🇷🇺",
        updatedAt: now,
      },
    },
    { session }
  );
  if (runtimeChanged.matchedCount !== 1)
    throw new Error("Russian succession requires its existing runtime country state");
  const stamped = await countries.updateOne(
    {
      _id: "RU",
      $or: [
        { ruSovietSuccessionSinceTurn: { $exists: false } },
        { ruSovietSuccessionSinceTurn: null },
      ],
    },
    {
      $set: {
        ruSovietSuccessionSinceTurn: appliedOnTurn,
        ruProvisionalCongressSeats: plan.totalSeats,
        updatedAt: now,
      },
    },
    { session }
  );
  if (stamped.matchedCount !== 1)
    throw new Error("Russian political succession changed during publication");
  invalidateCachedCountryState(db, "RU");
  return {
    retainedDeputies: plan.retained.length,
    retiredOffices: plan.retired.length,
    totalSeats: plan.totalSeats,
  };
}

/** Older saves retain their established Russian constitution. Only obsolete
 * Union mandates and deputies outside retained territory are retired. */
async function preserveEstablishedRussianConstitution(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  appliedOnTurn: number;
  now: Date;
  officials: ElectedOfficial[];
  retainedStateIds: string[];
}) {
  const { db, session, applicationId, appliedOnTurn, now, officials, retainedStateIds } = input;
  const retained = new Set(retainedStateIds);
  const retired = officials.filter(
    (row) =>
      UNION_OFFICES.includes(row.officeType) ||
      (["congressDeputy", "stateDumaDeputy", "federationCouncilMember"].includes(row.officeType) &&
        row.state != null &&
        !retained.has(row.state))
  );
  const retiredIds = new Set(retired.map((row) => row._id.toHexString()));
  const surviving = officials.filter((row) => !retiredIds.has(row._id.toHexString()));
  const survivingPlayers = new Set(
    surviving.flatMap((row) => (row.characterId ? [row.characterId.toHexString()] : []))
  );
  const survivingNpps = new Set(
    surviving.flatMap((row) => (row.nppId ? [row.nppId.toHexString()] : []))
  );
  const retiredPlayers = [
    ...new Set(
      retired.flatMap((row) =>
        row.characterId && !survivingPlayers.has(row.characterId.toHexString())
          ? [row.characterId.toHexString()]
          : []
      )
    ),
  ].map((id) => new ObjectId(id));
  const retiredNpps = [
    ...new Set(
      retired.flatMap((row) =>
        row.nppId && !survivingNpps.has(row.nppId.toHexString()) ? [row.nppId.toHexString()] : []
      )
    ),
  ].map((id) => new ObjectId(id));
  if (retired.length) {
    await db
      .collection<{
        _id: string;
        applicationId: string;
        sourceCountryId: string;
        value: ElectedOfficial;
      }>(FEDERATION_ARCHIVED_POLITICAL_ROWS_COLLECTION)
      .insertMany(
        retired.map((value) => ({
          _id: `${applicationId}:electedOfficials:${value._id.toHexString()}`,
          applicationId,
          sourceCountryId: "RU",
          value,
        })),
        { session }
      );
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ countryId: "RU", _id: { $in: retired.map((row) => row._id) } }, { session });
  }
  for (const [collection, ids] of [
    ["characters", retiredPlayers],
    ["npps", retiredNpps],
  ] as const) {
    await db.collection(collection).updateMany(
      {
        countryId: "RU",
        $or: [
          { "currentOffice.type": { $in: UNION_OFFICES } },
          {
            _id: { $in: ids },
            "currentOffice.type": {
              $in: ["congressDeputy", "stateDumaDeputy", "federationCouncilMember"],
            },
          },
        ],
      },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  }
  await db.collection<Election>("elections").updateMany(
    {
      countryId: "RU",
      officeType: { $in: UNION_OFFICES },
      status: { $in: ["upcoming", "active"] },
    },
    { $set: { status: "cancelled", updatedAt: now } },
    { session }
  );
  const governments = db.collection<GovernmentFormation>("governmentFormations");
  const government = await governments.findOne({ _id: "RU" }, { session });
  const lostHolder = (characterId?: ObjectId | null, nppId?: ObjectId | null) =>
    (characterId != null && retiredPlayers.some((id) => id.equals(characterId))) ||
    (nppId != null && retiredNpps.some((id) => id.equals(nppId)));
  const changes: Record<string, unknown> = {};
  if (government && lostHolder(government.pmCharacterId, government.pmNppId)) {
    Object.assign(changes, {
      pmCharacterId: null,
      pmNppId: null,
      pmName: null,
      status: "pending",
      activeVoteId: null,
      governingAgenda: null,
      fiscalStance: null,
      commandStance: null,
      pmVacancyDeadlineTurn: appliedOnTurn + PM_VACANCY_DEADLINE_TURNS,
    });
    for (const collection of ["pmAppointmentVotes", "noConfidenceVotes"]) {
      await db
        .collection(collection)
        .updateMany(
          { countryId: "RU", status: "active", office: { $ne: "headOfState" } },
          { $set: { status: "cancelled", closedAt: now, updatedAt: now } },
          { session }
        );
    }
    await db.collection("cabinetMembers").deleteMany({ countryId: "RU" }, { session });
    await db.collection("ukCabinetCooldowns").deleteMany({ countryId: "RU" }, { session });
    for (const collection of ["characters", "npps"]) {
      await db
        .collection(collection)
        .updateMany(
          { countryId: "RU", "currentOffice.type": "parliamentaryCabinet" },
          { $set: { currentOffice: null, updatedAt: now } },
          { session }
        );
    }
  }
  // A direct presidency or an absent legislature cannot retain a Union head-of-state ballot.
  await db
    .collection("pmAppointmentVotes")
    .updateMany(
      { countryId: "RU", status: "active", office: "headOfState" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } },
      { session }
    );
  if (government && lostHolder(government.hosCharacterId, government.hosNppId)) {
    Object.assign(changes, { hosCharacterId: null, hosNppId: null, hosName: null });
  }
  if (government?.presidentNppId && lostHolder(null, government.presidentNppId)) {
    Object.assign(changes, { presidentNppId: null, presidentName: null });
  }
  if (Object.keys(changes).length)
    await governments.updateOne(
      { _id: "RU" },
      { $set: { ...changes, updatedAt: now } },
      { session }
    );
  await db
    .collection<CountryState>("countryState")
    .updateOne(
      { _id: "RU" },
      { $set: { displayNameOverride: "Russia", flagEmojiOverride: "🇷🇺", updatedAt: now } },
      { session }
    );
  const stamped = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      $or: [
        { ruSovietSuccessionSinceTurn: { $exists: false } },
        { ruSovietSuccessionSinceTurn: null },
      ],
    },
    { $set: { ruSovietSuccessionSinceTurn: appliedOnTurn, updatedAt: now } },
    { session }
  );
  if (stamped.matchedCount !== 1)
    throw new Error("Russian political succession changed during publication");
  invalidateCachedCountryState(db, "RU");
  return {
    retainedDeputies: surviving.filter((row) =>
      ["congressDeputy", "stateDumaDeputy"].includes(row.officeType)
    ).length,
    retiredOffices: retired.length,
    totalSeats: null,
  };
}
