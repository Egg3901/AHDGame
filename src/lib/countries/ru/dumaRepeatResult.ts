/**
 * Duma repeat certification replaces failed ballots while preserving certified winners.
 * materializeRussianDumaRepeatResult commits the complete replacement round and
 * its immutable combined receipt together, without activating the Assembly.
 */
import { type ClientSession, type Db, type ObjectId } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { loadRussianDumaCertificationInputs } from "./dumaCertificationInputs";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import {
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "./dumaRepeatOpening";
import { resolveRussianDumaRepeatGeneration } from "./rules/assemblyCohort";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export async function materializeRussianDumaRepeatResult(input: {
  db: Db;
  session: ClientSession;
  rootCohortId: ObjectId;
  generation: number;
  turn: number;
  now: Date;
}): Promise<RussianDumaResultRecord> {
  const { db, session, rootCohortId, generation, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Duma repeat certification needs a transaction, generation, turn and time");
  const opening = await db
    .collection<RussianDumaRepeatOpeningRecord>(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION)
    .findOne({ _id: `${rootCohortId.toHexString()}:repeat:${generation}` }, { session });
  if (
    !opening ||
    !opening.rootCohortId.equals(rootCohortId) ||
    opening.generation !== generation ||
    opening.cohortId.equals(rootCohortId) ||
    !opening.electionIds.length ||
    opening.electionIds.length !== opening.seatIds.length ||
    new Set(opening.electionIds.map((id) => id.toHexString())).size !==
      opening.electionIds.length ||
    new Set(opening.seatIds).size !== opening.seatIds.length ||
    opening.openedOnTurn > turn
  )
    throw new Error("Duma repeat certification has no valid generation opening");
  const results = db.collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION);
  const id = opening.cohortId.toHexString();
  const replay = await results.findOne({ _id: id }, { session });
  if (replay) {
    if (
      replay.countryId !== "RU" ||
      replay.preset !== "1991-default" ||
      !replay.cohortId.equals(opening.cohortId) ||
      !replay.rootCohortId?.equals(rootCohortId) ||
      replay.generation !== generation ||
      replay.mandateSinceTurn !== opening.mandateSinceTurn
    )
      throw new Error("Duma repeat result identity changed");
    return replay;
  }
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") throw new Error("No Duma repeat mandate in this world");
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
    country.ruFederalAssemblySinceTurn != null ||
    country.ruFederalAssemblyMandateSinceTurn !== opening.mandateSinceTurn ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("Duma repeat constitutional mandate changed");
  const previous = await results.findOne({ _id: opening.previousResultId }, { session });
  if (
    !previous?.ballots ||
    previous.countryId !== "RU" ||
    previous.preset !== "1991-default" ||
    !(previous.rootCohortId ?? previous.cohortId).equals(rootCohortId) ||
    previous.mandateSinceTurn !== opening.mandateSinceTurn ||
    (previous.generation ?? 0) !== generation - 1 ||
    previous._id !== previous.cohortId.toHexString() ||
    previous.resolvedOnTurn > opening.openedOnTurn ||
    previous.seatedOnTurn != null
  )
    throw new Error("Duma repeat predecessor changed");
  const elections = db.collection<Election>("elections");
  const cohort = await elections
    .find(
      { countryId: "RU", "russianDumaRound.cohortId": opening.cohortId },
      {
        session,
        batchSize: 1000,
        projection: {
          electionType: 1,
          status: 1,
          endTurn: 1,
          state: 1,
          seatId: 1,
          totalSeats: 1,
          russianDumaRound: 1,
        },
      }
    )
    .toArray();
  const expectedIds = new Set(opening.electionIds.map((id) => id.toHexString()));
  const oldBySeat = new Map(previous.ballots.map((row) => [row.seatId, row]));
  if (
    cohort.length !== expectedIds.size ||
    cohort.some(
      (row) =>
        !expectedIds.has(row._id.toHexString()) ||
        !row.seatId ||
        !opening.seatIds.includes(row.seatId) ||
        row.electionType !== "dumaDeputy" ||
        row.status !== "completed" ||
        !Number.isSafeInteger(row.endTurn) ||
        row.endTurn! > turn ||
        row.russianDumaRound?.generation !== generation ||
        !row.russianDumaRound.rootCohortId?.equals(rootCohortId) ||
        row.russianDumaRound.mandateSinceTurn !== opening.mandateSinceTurn ||
        row.russianDumaRound.predecessorElectionId?.toHexString() !==
          oldBySeat.get(row.seatId)?.id ||
        row.totalSeats !== (row.russianDumaRound.tier === "list" ? 225 : 1)
    )
  )
    throw new Error("The complete Duma repeat generation must finish before certification");
  const loaded = await loadRussianDumaCertificationInputs({ db, session, cohort });
  const combined = resolveRussianDumaRepeatGeneration({
    previousBallots: previous.ballots,
    replacements: loaded.ballots,
  });
  const outcomes = new Map(
    combined.result.constituencyResults.map((row) => [row.electionId, row.decision.outcome])
  );
  outcomes.set(combined.result.listElectionId, combined.result.listDecision.outcome);
  const finalized = await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    loaded.counted.map((row) => ({
      updateOne: {
        filter: { _id: row._id, finalized: false },
        update: {
          $set: {
            finalized: true,
            "russianDumaBallot.againstAllVotes": row.russianDumaBallot?.againstAllVotes ?? 0,
            "russianDumaBallot.outcome": outcomes.get(row.electionId.toHexString()),
            "russianDumaBallot.certifiedCohortId": opening.cohortId,
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  if (finalized.matchedCount !== cohort.length)
    throw new Error("Duma repeat tallies changed during certification");
  const resolved = await elections.updateMany(
    {
      _id: { $in: opening.electionIds },
      status: "completed",
      "russianDumaRound.cohortId": opening.cohortId,
    },
    { $set: { status: "resolved", resolving: false, updatedAt: now } },
    { session }
  );
  if (resolved.matchedCount !== cohort.length)
    throw new Error("Duma repeat ballots changed during certification");
  const retired = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: opening.electionIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  if (retired.matchedCount !== loaded.candidates.filter((row) => row.status === "active").length)
    throw new Error("Duma repeat candidacies changed during certification");
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
  if (bound.matchedCount !== 1) throw new Error("Duma repeat mandate changed during certification");
  const nomineeIds = new Set(
    combined.ballots.flatMap((row) => row.candidates.map((candidate) => candidate.id))
  );
  const nominees = [
    ...previous.nominees.filter((row) => nomineeIds.has(row.candidateId.toHexString())),
    ...loaded.candidates
      .filter((row) => loaded.registeredCandidateIds.has(row._id.toHexString()))
      .map((row) => ({
        candidateId: row._id,
        ownerId: row.isNPP ? row.nppId! : row.characterId,
        isNpc: !!row.isNPP,
        name: row.characterName,
        party: row.party,
      })),
  ];
  const currentVotes = { ...previous.votesByElection, ...loaded.votesByElection };
  const record: RussianDumaResultRecord = {
    _id: id,
    countryId: "RU",
    preset: "1991-default",
    cohortId: opening.cohortId,
    rootCohortId,
    generation,
    mandateSinceTurn: opening.mandateSinceTurn,
    resolvedOnTurn: turn,
    createdAt: now,
    result: combined.result,
    ballots: combined.ballots,
    nominees,
    votesByElection: Object.fromEntries(
      combined.ballots.map((row) => [row.id, currentVotes[row.id]])
    ),
  };
  await results.insertOne(record, { session });
  return record;
}

export async function certifyRussianDumaRepeat(
  input: Omit<Parameters<typeof materializeRussianDumaRepeatResult>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianDumaRepeatResult({ ...input, session }),
    { client: input.db.client }
  );
}
