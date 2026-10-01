/**
 * Duma repeat rounds admit fresh bounded NPC nominees without duplicating accounts.
 * materializeRussianDumaRepeatNpcAdmission validates the immutable round lineage,
 * registers its entire slate atomically and records replay-safe admission reasons.
 */
import { type ClientSession, type Db, type ObjectId } from "mongodb";
import type { CountryGameState, Election, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ensureBoundedNpcCandidateGuards } from "@/lib/admin/seed/indexes/boundedNpcCandidates";
import {
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "./dumaRepeatOpening";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import { registerRussianDumaNpcSlates } from "./dumaNpcRegistration";
import { resolveRussianDumaRepeatGeneration } from "./rules/assemblyCohort";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export async function materializeRussianDumaRepeatNpcAdmission(input: {
  db: Db;
  session: ClientSession;
  rootCohortId: ObjectId;
  generation: number;
  turn: number;
  now: Date;
}): Promise<{ created: number; unrepresentedParties: string[] } | null> {
  const { db, session, rootCohortId, generation, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isSafeInteger(now.getTime()) ||
    now.getTime() < 0
  )
    throw new Error("Duma repeat admission requires a transaction, generation, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFirstDumaElectionCohortId: 1,
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId?.equals(rootCohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  const openings = db.collection<RussianDumaRepeatOpeningRecord>(
    RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION
  );
  const opening = await openings.findOne(
    { _id: `${rootCohortId.toHexString()}:repeat:${generation}` },
    { session }
  );
  if (
    !opening?.rootCohortId.equals(rootCohortId) ||
    opening.generation !== generation ||
    opening.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    opening.openedOnTurn > turn ||
    opening.cohortId.equals(rootCohortId)
  )
    throw new Error("Duma repeat admission has no matching opening");
  if (opening.npcAdmission)
    return { created: 0, unrepresentedParties: opening.npcAdmission.unrepresentedParties };
  if (country.ruFederalAssemblySinceTurn != null) return null;
  const previous = await db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .findOne({ _id: opening.previousResultId }, { session });
  if (
    !previous?.ballots ||
    previous.countryId !== "RU" ||
    previous.preset !== "1991-default" ||
    !(previous.rootCohortId ?? previous.cohortId).equals(rootCohortId) ||
    (previous.generation ?? 0) !== generation - 1 ||
    previous.mandateSinceTurn !== opening.mandateSinceTurn ||
    previous._id !== previous.cohortId.toHexString() ||
    previous.resolvedOnTurn > opening.openedOnTurn ||
    previous.seatedOnTurn != null
  )
    throw new Error("Duma repeat admission predecessor changed");
  const elections = await db
    .collection<Election>("elections")
    .find(
      { countryId: "RU", "russianDumaRound.cohortId": opening.cohortId },
      {
        session,
        batchSize: 1000,
        projection: {
          state: 1,
          seatId: 1,
          totalSeats: 1,
          status: 1,
          electionType: 1,
          primaryEndTurn: 1,
          russianDumaRound: 1,
        },
      }
    )
    .toArray();
  const expectedIds = new Set(opening.electionIds.map((id) => id.toHexString()));
  const oldBySeat = new Map(previous.ballots.map((row) => [row.seatId, row]));
  if (
    !expectedIds.size ||
    expectedIds.size !== opening.electionIds.length ||
    elections.length !== expectedIds.size ||
    opening.seatIds.length !== expectedIds.size ||
    new Set(opening.seatIds).size !== expectedIds.size ||
    elections.some(
      (row) =>
        !expectedIds.has(row._id.toHexString()) ||
        !row.seatId ||
        !opening.seatIds.includes(row.seatId) ||
        row.electionType !== "dumaDeputy" ||
        row.russianDumaRound?.generation !== generation ||
        !row.russianDumaRound.rootCohortId?.equals(rootCohortId) ||
        row.russianDumaRound.mandateSinceTurn !== opening.mandateSinceTurn ||
        row.russianDumaRound.predecessorElectionId?.toHexString() !==
          oldBySeat.get(row.seatId)?.id ||
        row.totalSeats !== (row.russianDumaRound.tier === "list" ? 225 : 1)
    )
  )
    throw new Error("Duma repeat admission found an invalid bound ballot");
  if (
    elections.some(
      (row) =>
        !["upcoming", "active"].includes(row.status) ||
        !Number.isSafeInteger(row.primaryEndTurn) ||
        row.primaryEndTurn! <= turn
    )
  )
    return null;
  // Zero participation validates the replacement map without seating a winner.
  resolveRussianDumaRepeatGeneration({
    previousBallots: previous.ballots,
    replacements: elections.map((row) => ({
      id: row._id.toHexString(),
      seatId: row.seatId!,
      regionId: row.state,
      tier: row.russianDumaRound!.tier,
      registeredVoters: row.russianDumaRound!.registeredVoters,
      againstAllVotes: 0,
      candidates: [],
    })),
  });
  const registration = await registerRussianDumaNpcSlates({
    db,
    session,
    cohortId: opening.cohortId,
    elections,
    now,
  });
  const receipt = await openings.updateOne(
    {
      _id: opening._id,
      cohortId: opening.cohortId,
      previousResultId: opening.previousResultId,
      npcAdmission: { $exists: false },
    },
    {
      $set: {
        npcAdmission: {
          completedOnTurn: turn,
          createdCandidates: registration.created,
          unrepresentedParties: registration.unrepresentedParties,
        },
      },
    },
    { session }
  );
  if (receipt.matchedCount !== 1) throw new Error("Duma repeat admission receipt changed");
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstDumaElectionCohortId: rootCohortId,
      ruFederalAssemblyMandateSinceTurn: opening.mandateSinceTurn,
      ruFederalAssemblySinceTurn: { $exists: false },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Duma repeat admission mandate changed");
  return registration;
}

export async function admitRussianDumaRepeatNpcNominees(
  input: Omit<Parameters<typeof materializeRussianDumaRepeatNpcAdmission>[0], "session">
) {
  if (
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1 ||
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isSafeInteger(input.now.getTime()) ||
    input.now.getTime() < 0
  )
    throw new Error("Duma repeat admission requires a generation, turn and time");
  const game = await input.db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const country = await input.db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RU", ruFirstDumaElectionCohortId: input.rootCohortId },
      { projection: { ruSovietSuccessionSinceTurn: 1, ruFederalAssemblyMandateSinceTurn: 1 } }
    );
  if (
    !country ||
    !hasAuthorizedPostSovietTransition(
      input.turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  const opening = await input.db
    .collection<RussianDumaRepeatOpeningRecord>(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION)
    .findOne(
      { _id: `${input.rootCohortId.toHexString()}:repeat:${input.generation}` },
      { projection: { rootCohortId: 1, generation: 1, mandateSinceTurn: 1, npcAdmission: 1 } }
    );
  if (
    opening?.rootCohortId.equals(input.rootCohortId) &&
    opening.generation === input.generation &&
    opening.mandateSinceTurn === country.ruFederalAssemblyMandateSinceTurn &&
    opening.npcAdmission
  )
    return { created: 0, unrepresentedParties: opening.npcAdmission.unrepresentedParties };
  await ensureBoundedNpcCandidateGuards(input.db);
  return runRequiredTransaction(
    (session) => materializeRussianDumaRepeatNpcAdmission({ ...input, session }),
    { client: input.db.client }
  );
}
