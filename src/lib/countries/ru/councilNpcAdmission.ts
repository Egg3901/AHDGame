/**
 * Council association nominees use bounded candidacy identities and existing accounts.
 * materializeRussianCouncilNpcAdmission validates the immutable opening, excludes
 * Duma-reserved profiles and commits every nominee with one admission receipt.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionCandidate,
  GameState,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ensureBoundedNpcCandidateGuards } from "@/lib/admin/seed/indexes/boundedNpcCandidates";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import {
  materializeRussianCouncilElectionOpening,
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import { loadRussianCouncilOpeningBinding } from "./councilOpeningBinding";
import { materializeRussianCouncilRepeatOpening } from "./councilRepeatOpening";
import { planRussianCouncilNpcSlates } from "./rules/councilNpcSlates";

export async function materializeRussianCouncilNpcAdmission(input: {
  db: Db;
  session: ClientSession;
  cohortId: ObjectId;
  turn: number;
  now: Date;
}) {
  const { db, session, cohortId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isSafeInteger(now.getTime()) ||
    now.getTime() < 0
  )
    throw new Error("Council admission needs an active transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFirstCouncilElectionCohortId: 1,
        ruCouncilComposition: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
        ruDumaNpcAdmissionCohortId: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
      },
    }
  );
  if (!country?.ruFirstCouncilElectionCohortId || country.ruCouncilComposition) return null;
  // Duma admission precedes Council admission so profile reservations remain disjoint.
  if (
    !country.ruFirstDumaElectionCohortId ||
    !country.ruDumaNpcAdmissionCohortId?.equals(country.ruFirstDumaElectionCohortId)
  )
    return null;
  const openings = db.collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION);
  const binding = await loadRussianCouncilOpeningBinding({ db, session, country, cohortId, turn });
  if (!binding) throw new Error("Council admission lost its opening receipt");
  const { opening: receipt, rootCohortId } = binding;
  if (receipt.npcAdmission)
    return { created: 0, unrepresentedParties: receipt.npcAdmission.unrepresentedParties };
  if (receipt.generation) {
    const repeated = await materializeRussianCouncilRepeatOpening({
      db,
      session,
      rootCohortId,
      previousResultId: receipt.previousResultId!,
      cohortId,
      electionIds: [],
      turn,
      now,
    });
    if (!repeated?.record.cohortId.equals(cohortId)) return null;
  } else {
    const boundOpening = await materializeRussianCouncilElectionOpening({
      db,
      session,
      game,
      turn,
      now,
      cohortId,
      electionIds: [],
    });
    if (!boundOpening?.cohortId.equals(cohortId)) return null;
  }
  const elections = await db
    .collection<Election>("elections")
    .find(
      { countryId: "RU", "russianCouncilRound.cohortId": cohortId },
      {
        session,
        batchSize: 1000,
        projection: {
          state: 1,
          status: 1,
          primaryEndTurn: 1,
          seatId: 1,
          totalSeats: 1,
          electionType: 1,
          russianCouncilRound: 1,
        },
      }
    )
    .toArray();
  if (
    elections.length !== binding.ballots.length ||
    elections.some((row) => {
      const expected = binding.ballots.find((ballot) => ballot.id.equals(row._id));
      return (
        !expected ||
        row.electionType !== "federationCouncilMember" ||
        row.totalSeats !== 2 ||
        row.seatId !== expected.seatId ||
        row.state !== expected.regionId ||
        row.russianCouncilRound?.registeredVoters !== expected.registeredVoters ||
        row.russianCouncilRound?.districtNumber !== expected.districtNumber ||
        row.russianCouncilRound?.mandateSinceTurn !== receipt.mandateSinceTurn ||
        ("predecessorId" in expected &&
          expected.predecessorId !==
            row.russianCouncilRound?.predecessorElectionId?.toHexString()) ||
        (!receipt.generation &&
          (row.russianCouncilRound?.rootCohortId != null ||
            row.russianCouncilRound?.generation != null ||
            row.russianCouncilRound?.predecessorElectionId != null)) ||
        (receipt.generation &&
          (row.russianCouncilRound?.generation !== receipt.generation ||
            !row.russianCouncilRound?.rootCohortId?.equals(rootCohortId)))
      );
    })
  )
    throw new Error("Council admission ballot bindings changed");
  if (
    elections.some(
      (row) =>
        !["active", "upcoming"].includes(row.status) ||
        !Number.isSafeInteger(row.primaryEndTurn) ||
        row.primaryEndTurn! <= turn
    )
  )
    return null;
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: "RU", regimeStatus: { $ne: "banned" } },
      { session, projection: { sequentialId: 1 } }
    )
    .toArray();
  if (parties.some((row) => !Number.isSafeInteger(row.sequentialId) || row.sequentialId < 1))
    throw new Error("Council admission needs registered associations");
  const partyIds = parties.map((row) => String(row.sequentialId));
  const profiles = await db
    .collection<NPP>("npps")
    .find(
      {
        countryId: "RU",
        party: { $in: partyIds },
        isTechnocrat: { $ne: true },
        $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
      },
      {
        session,
        batchSize: 1000,
        projection: { name: 1, party: 1, homeState: 1, currentOffice: 1 },
      }
    )
    .toArray();
  const candidates = db.collection<ElectionCandidate>("electionCandidates");
  const active = await candidates
    .find(
      { electionId: { $in: elections.map((row) => row._id) }, status: "active" },
      { session, batchSize: 1000, projection: { electionId: 1, party: 1 } }
    )
    .toArray();
  const duma = await candidates
    .find(
      { countryId: "RU", isNPP: true, russianDumaNomination: { $exists: true } },
      { session, batchSize: 1000, projection: { nppId: 1 } }
    )
    .toArray();
  const plan = planRussianCouncilNpcSlates({
    ballots: elections.map((row) => ({ id: row._id.toHexString(), regionId: row.state })),
    parties: partyIds,
    excludedProfileIds: duma.flatMap((row) => (row.nppId ? [row.nppId.toHexString()] : [])),
    activeCandidates: active.map((row) => ({
      electionId: row.electionId.toHexString(),
      party: row.party,
    })),
    profiles: profiles.map((row) => {
      const office =
        typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type;
      return {
        id: row._id.toHexString(),
        party: row.party,
        homeState: row.homeState,
        eligible:
          !row.currentOffice || office === "congressDeputy" || office === "federationCouncilMember",
      };
    }),
  });
  const byId = new Map(profiles.map((row) => [row._id.toHexString(), row]));
  const documents: ElectionCandidate[] = plan.nominees.map((row) => {
    const profile = byId.get(row.profileId)!;
    const id = new ObjectId(
      createHash("sha256")
        .update(`council:${cohortId.toHexString()}:${row.nomineeKey}`)
        .digest("hex")
        .slice(0, 24)
    );
    return {
      _id: id,
      boundedNpcNomineeId: id,
      electionId: new ObjectId(row.electionId),
      countryId: "RU",
      characterId: profile._id,
      nppId: profile._id,
      isNPP: true,
      characterName: `${profile.name} nominee`,
      party: row.party,
      status: "active",
      enteredAt: now,
      support: DEFAULT_CANDIDATE_SUPPORT,
      russianCouncilNomination: { registrationOrder: now.getTime() },
    };
  });
  if (documents.length) await candidates.insertMany(documents, { session, ordered: true });
  const claimed = await openings.updateOne(
    {
      _id: receipt._id,
      cohortId,
      mandateSinceTurn: receipt.mandateSinceTurn,
      npcAdmission: { $exists: false },
    },
    {
      $set: {
        npcAdmission: {
          createdCandidates: documents.length,
          unrepresentedParties: plan.unrepresentedParties,
          completedOnTurn: turn,
        },
      },
    },
    { session }
  );
  if (claimed.matchedCount !== 1)
    throw new Error("Council admission receipt changed during registration");
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstCouncilElectionCohortId: rootCohortId,
      ruFederalAssemblyMandateSinceTurn: receipt.mandateSinceTurn,
      ruDumaNpcAdmissionCohortId: country.ruFirstDumaElectionCohortId,
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1)
    throw new Error("Council admission mandate changed during registration");
  return { created: documents.length, unrepresentedParties: plan.unrepresentedParties };
}

export async function admitRussianCouncilNpcNominees(
  input: Omit<Parameters<typeof materializeRussianCouncilNpcAdmission>[0], "session">
) {
  if (
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isSafeInteger(input.now.getTime()) ||
    input.now.getTime() < 0
  )
    throw new Error("Council admission needs a safe turn and time");
  const game = await input.db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const country = await input.db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      projection: {
        ruFirstCouncilElectionCohortId: 1,
        ruCouncilComposition: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
      },
    }
  );
  if (!country) return null;
  const bound = await loadRussianCouncilOpeningBinding({
    db: input.db,
    cohortId: input.cohortId,
    turn: input.turn,
    country,
  });
  if (!bound) return null;
  if (bound.opening.npcAdmission)
    return { created: 0, unrepresentedParties: bound.opening.npcAdmission.unrepresentedParties };
  await ensureBoundedNpcCandidateGuards(input.db);
  return runRequiredTransaction(
    (session) => materializeRussianCouncilNpcAdmission({ ...input, session }),
    { client: input.db.client }
  );
}
