/**
 * First-Duma certification counts both tiers together and records vacancies.
 * materializeRussianDumaElectionResult freezes one complete cohort atomically,
 * validates owners in batches and preserves Congress until a separate handover.
 */
import { russianDumaElectoralLaw } from "./rules/dumaElectoralLaw";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { resolveRussianDumaCohort, type RussianDumaCohortBallot } from "./rules/assemblyCohort";
import { loadRussianDumaCertificationInputs } from "./dumaCertificationInputs";
import {
  russianDumaBoundRoot,
  loadRussianDumaAuthority,
  russianDumaRootFilter,
} from "./dumaConvocationAuthority";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export const RUSSIAN_DUMA_RESULTS_COLLECTION = "russianDumaElectionResults";
export interface RussianDumaResultRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  cohortId: ObjectId;
  rootCohortId?: ObjectId;
  generation?: number;
  mandateSinceTurn: number;
  resolvedOnTurn: number;
  createdAt: Date;
  result: ReturnType<typeof resolveRussianDumaCohort>;
  votesByElection: Record<string, { votes: Record<string, number>; againstAllVotes: number }>;
  /** New receipts preserve original registration, nomination order and eligibility for repeats. */
  ballots?: RussianDumaCohortBallot[];
  nominees: Array<{
    candidateId: ObjectId;
    ownerId: ObjectId;
    isNpc: boolean;
    name: string;
    party: string;
  }>;
  seatedOnTurn?: number;
}

export async function materializeRussianDumaElectionResult(input: {
  db: Db;
  session: ClientSession;
  cohortId: ObjectId;
  turn: number;
  now: Date;
}): Promise<RussianDumaResultRecord> {
  const { db, session, cohortId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Duma certification needs an active transaction, turn and time");
  const results = db.collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION);
  const previous = await results.findOne({ _id: cohortId.toHexString() }, { session });
  if (previous) {
    if (
      previous.countryId !== "RU" ||
      previous.preset !== "1991-default" ||
      !previous.cohortId.equals(cohortId)
    )
      throw new Error("Russian Duma result identity changed");
    return previous;
  }
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") throw new Error("No first-Duma mandate in this world");
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
        ruDumaCurrentConvocationCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country ||
    !russianDumaBoundRoot(country)?.equals(cohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("The first-Duma constitutional mandate changed");
  const authority = await loadRussianDumaAuthority({ db, session, country, root: cohortId, turn });
  if (!authority) throw new Error("Duma campaign authority changed");
  const elections = db.collection<Election>("elections");
  const cohort = await elections
    .find(
      { countryId: "RU", "russianDumaRound.cohortId": cohortId },
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
  if (
    cohort.length !== 226 ||
    cohort.some(
      (row) =>
        row.electionType !== "dumaDeputy" ||
        row.status !== "completed" ||
        !Number.isSafeInteger(row.endTurn) ||
        row.endTurn! > turn ||
        row.russianDumaRound?.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
        russianDumaElectoralLaw(row.russianDumaRound?.electoralLaw) !==
          russianDumaElectoralLaw(authority.record?.electoralLaw) ||
        row.totalSeats !== (row.russianDumaRound?.tier === "list" ? 225 : 1)
    )
  )
    throw new Error("The entire first-Duma cohort must finish before certification");
  const { ballots, counted, candidates, registeredCandidateIds, votesByElection } =
    await loadRussianDumaCertificationInputs({
      db,
      session,
      cohort,
      councilCohortId: country.ruFirstCouncilElectionCohortId,
      convocationNumber: authority.number,
    });
  const electionIds = cohort.map((row) => row._id);
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const result = resolveRussianDumaCohort(ballots);
  const outcomes = new Map(
    result.constituencyResults.map((row) => [row.electionId, row.decision.outcome])
  );
  outcomes.set(result.listElectionId, result.listDecision.outcome);
  const finalized = await tallies.bulkWrite(
    counted.map((row) => ({
      updateOne: {
        filter: { _id: row._id, finalized: false },
        update: {
          $set: {
            finalized: true,
            "russianDumaBallot.againstAllVotes": row.russianDumaBallot?.againstAllVotes ?? 0,
            "russianDumaBallot.outcome": outcomes.get(row.electionId.toHexString()),
            "russianDumaBallot.certifiedCohortId": cohortId,
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  if (finalized.matchedCount !== 226) throw new Error("Duma tallies changed during certification");
  const resolved = await elections.updateMany(
    { _id: { $in: electionIds }, status: "completed", "russianDumaRound.cohortId": cohortId },
    { $set: { status: "resolved", resolving: false, updatedAt: now } },
    { session }
  );
  if (resolved.matchedCount !== 226) throw new Error("Duma ballots changed during certification");
  // Release the global active-candidacy index for future and repeat ballots.
  // The immutable result above retains the nominees and counted votes.
  const expectedActive = candidates.filter((row) => row.status === "active").length;
  const retired = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { electionId: { $in: electionIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  if (retired.matchedCount !== expectedActive)
    throw new Error("Duma candidacies changed during certification");
  // Take a write conflict on the bound mandate without activating the Assembly.
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ...russianDumaRootFilter(country, cohortId),
      ruFederalAssemblyMandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Duma mandate changed during certification");
  const record: RussianDumaResultRecord = {
    _id: cohortId.toHexString(),
    countryId: "RU",
    preset: "1991-default",
    cohortId,
    mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn!,
    resolvedOnTurn: turn,
    createdAt: now,
    result,
    votesByElection,
    ballots,
    nominees: candidates
      .filter((row) => registeredCandidateIds.has(row._id.toHexString()))
      .map((row) => ({
        candidateId: row._id,
        ownerId: row.isNPP ? row.nppId! : row.characterId,
        isNpc: !!row.isNPP,
        name: row.characterName,
        party: row.party,
      })),
  };
  await results.insertOne(record, { session });
  return record;
}

export async function certifyRussianDumaElection(
  input: Omit<Parameters<typeof materializeRussianDumaElectionResult>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianDumaElectionResult({ ...input, session }),
    { client: input.db.client }
  );
}
