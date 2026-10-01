/**
 * Repeat Council certification replaces failed polls without changing held mandates.
 * materializeRussianCouncilRepeatResult finalizes the complete new generation and
 * preserves its accumulated89-subject receipt atomically before joint seating.
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
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import { loadRussianCouncilOpeningBinding } from "./councilOpeningBinding";
import { loadRussianCouncilCertificationInputs } from "./councilCertificationInputs";
import { resolveRussianCouncilRepeat } from "./rules/councilRepeat";
import { resolveRussianCouncilAccumulatedCohort } from "./rules/councilCohort";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export async function materializeRussianCouncilRepeatResult(input: {
  db: Db;
  session: ClientSession;
  rootCohortId: ObjectId;
  generation: number;
  turn: number;
  now: Date;
}): Promise<RussianCouncilResultRecord> {
  const { db, session, rootCohortId, generation, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Council repeat certification needs a transaction, generation, turn and time");
  const opening = await db
    .collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION)
    .findOne({ _id: `${rootCohortId.toHexString()}:repeat:${generation}` }, { session });
  if (
    !opening?.rootCohortId?.equals(rootCohortId) ||
    opening.generation !== generation ||
    opening.cohortId.equals(rootCohortId) ||
    !Number.isSafeInteger(opening.openedOnTurn) ||
    opening.openedOnTurn > turn
  )
    throw new Error("Council repeat certification has no valid generation opening");
  const results = db.collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION);
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
      throw new Error("Council repeat result identity changed");
    return replay;
  }
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFirstCouncilElectionCohortId: 1,
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    game?.preset !== "1991-default" ||
    !country?.ruFirstCouncilElectionCohortId?.equals(rootCohortId) ||
    country.ruFederalAssemblyMandateSinceTurn !== opening.mandateSinceTurn ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("Council repeat constitutional mandate changed");
  const binding = await loadRussianCouncilOpeningBinding({
    db,
    session,
    country,
    cohortId: opening.cohortId,
    turn,
  });
  if (
    !binding ||
    !("previous" in binding) ||
    !binding.previous ||
    !Number.isSafeInteger(binding.previous.resolvedOnTurn) ||
    binding.previous.resolvedOnTurn > opening.openedOnTurn
  )
    throw new Error("Council repeat predecessor changed");
  const previous = binding.previous;
  const previousNominees = await results.findOne(
    { _id: opening.previousResultId },
    { session, projection: { nominees: 1 } }
  );
  if (!previousNominees) throw new Error("Council repeat predecessor nominees disappeared");
  const elections = db.collection<Election>("elections");
  const cohort = await elections
    .find(
      { countryId: "RU", "russianCouncilRound.cohortId": opening.cohortId },
      {
        session,
        batchSize: 1000,
        projection: {
          countryId: 1,
          electionType: 1,
          status: 1,
          endTurn: 1,
          state: 1,
          seatId: 1,
          totalSeats: 1,
          russianCouncilRound: 1,
        },
      }
    )
    .toArray();
  const expected = new Map(binding.ballots.map((row) => [row.id.toHexString(), row]));
  if (
    cohort.length !== expected.size ||
    cohort.some((row) => {
      const ballot = expected.get(row._id.toHexString());
      return (
        !ballot ||
        row.electionType !== "federationCouncilMember" ||
        row.totalSeats !== 2 ||
        row.status !== "completed" ||
        !Number.isSafeInteger(row.endTurn) ||
        row.endTurn! > turn ||
        row.state !== ballot.regionId ||
        row.seatId !== ballot.seatId ||
        row.russianCouncilRound?.generation !== generation ||
        !row.russianCouncilRound?.rootCohortId?.equals(rootCohortId) ||
        row.russianCouncilRound?.mandateSinceTurn !== opening.mandateSinceTurn ||
        row.russianCouncilRound?.registeredVoters !== ballot.registeredVoters ||
        row.russianCouncilRound?.districtNumber !== ballot.districtNumber ||
        row.russianCouncilRound?.predecessorElectionId?.toHexString() !==
          ("predecessorId" in ballot ? ballot.predecessorId : undefined)
      );
    })
  )
    throw new Error("The complete Council repeat generation must finish before certification");
  const loaded = await loadRussianCouncilCertificationInputs({ db, session, cohort, country });
  const heldPlayers = new Set(
    resolveRussianCouncilAccumulatedCohort(previous.ballots).flatMap((row) =>
      row.winners.filter((winner) => !winner.isNpc).map((winner) => winner.ownerId)
    )
  );
  const replacements = loaded.ballots.map((row) => ({
    ...row,
    candidates: row.candidates.map((candidate) => ({
      ...candidate,
      eligible: candidate.eligible && (candidate.isNpc || !heldPlayers.has(candidate.ownerId)),
    })),
  }));
  const combined = resolveRussianCouncilRepeat({ previous: previous.ballots, replacements });
  const outcomes = new Map(combined.result.map((row) => [row.electionId, row.decision.outcome]));
  const finalized = await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(
    loaded.counted.map((row) => {
      const ballot = replacements.find((ballot) => ballot.id === row.electionId.toHexString())!;
      return {
        updateOne: {
          filter: { _id: row._id, finalized: false },
          update: {
            $set: {
              finalized: true,
              russianCouncilBallot: {
                ...row.russianCouncilBallot,
                registeredVoters: ballot.registeredVoters,
                validBallots: ballot.validBallots,
                againstAllVotes: ballot.againstAllVotes,
                registrationOrderByCandidate: Object.fromEntries(
                  ballot.candidates.map((candidate) => [candidate.id, candidate.registrationOrder])
                ),
                outcome: outcomes.get(ballot.id),
                certifiedCohortId: opening.cohortId,
              },
              updatedAt: now,
            },
          },
        },
      };
    }),
    { session }
  );
  if (finalized.matchedCount !== cohort.length)
    throw new Error("Council repeat tallies changed during certification");
  const resolved = await elections.updateMany(
    {
      _id: { $in: opening.electionIds },
      status: "completed",
      "russianCouncilRound.cohortId": opening.cohortId,
    },
    { $set: { status: "resolved", resolving: false, updatedAt: now } },
    { session }
  );
  if (resolved.matchedCount !== cohort.length)
    throw new Error("Council repeat ballots changed during certification");
  const retired = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: opening.electionIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  if (retired.matchedCount !== loaded.candidates.filter((row) => row.status === "active").length)
    throw new Error("Council repeat nominations changed during certification");
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstCouncilElectionCohortId: rootCohortId,
      ruFederalAssemblyMandateSinceTurn: opening.mandateSinceTurn,
      ruFederalAssemblySinceTurn: country.ruFederalAssemblySinceTurn ?? { $exists: false },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1)
    throw new Error("Council repeat mandate changed during certification");
  const candidateIds = new Set(
    combined.ballots.flatMap((row) => row.candidates.map((candidate) => candidate.id))
  );
  const record: RussianCouncilResultRecord = {
    _id: id,
    countryId: "RU",
    preset: "1991-default",
    cohortId: opening.cohortId,
    rootCohortId,
    generation,
    mandateSinceTurn: opening.mandateSinceTurn,
    resolvedOnTurn: turn,
    createdAt: now,
    ballots: combined.ballots,
    result: combined.result,
    nominees: [
      ...previousNominees.nominees.filter((row) => candidateIds.has(row.candidateId.toHexString())),
      ...loaded.candidates
        .filter((row) => loaded.registeredCandidateIds.has(row._id.toHexString()))
        .map((row) => ({
          candidateId: row._id,
          ownerId: row.isNPP ? row.nppId! : row.characterId,
          isNpc: !!row.isNPP,
          name: row.characterName,
          party: row.party,
        })),
    ],
  };
  await results.insertOne(record, { session });
  return record;
}
export function certifyRussianCouncilRepeat(
  input: Omit<Parameters<typeof materializeRussianCouncilRepeatResult>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianCouncilRepeatResult({ ...input, session }),
    { client: input.db.client }
  );
}
