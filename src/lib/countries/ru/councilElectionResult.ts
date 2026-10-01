/**
 * First Council certification freezes all 89 subject results in one transaction.
 * materializeRussianCouncilElectionResult validates the ratified opening and
 * actual owners, records vacancies and keeps Congress until joint chamber handover.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import { loadRussianCouncilCertificationInputs } from "./councilCertificationInputs";
import {
  resolveRussianCouncilCohort,
  type RussianCouncilCohortBallot,
} from "./rules/councilCohort";
import { planRussianCouncilDistricts } from "./rules/councilDistricts";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
export const RUSSIAN_COUNCIL_RESULTS_COLLECTION = "russianCouncilElectionResults";
export interface RussianCouncilResultRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  cohortId: ObjectId;
  /** Repeat receipts preserve all held subjects under the original mandate. */
  rootCohortId?: ObjectId;
  generation?: number;
  mandateSinceTurn: number;
  resolvedOnTurn: number;
  createdAt: Date;
  result: ReturnType<typeof resolveRussianCouncilCohort>;
  ballots: RussianCouncilCohortBallot[];
  nominees: Array<{
    candidateId: ObjectId;
    ownerId: ObjectId;
    isNpc: boolean;
    name: string;
    party: string;
  }>;
  seatedOnTurn?: number;
}
export async function materializeRussianCouncilElectionResult(input: {
  db: Db;
  session: ClientSession;
  cohortId: ObjectId;
  turn: number;
  now: Date;
}): Promise<RussianCouncilResultRecord> {
  const { db, session, cohortId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Council certification needs an active transaction, turn and time");
  const results = db.collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION);
  const previous = await results.findOne({ _id: cohortId.toHexString() }, { session });
  if (previous) {
    if (
      previous.countryId !== "RU" ||
      previous.preset !== "1991-default" ||
      !previous.cohortId.equals(cohortId)
    )
      throw new Error("Council result identity changed");
    return previous;
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
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
      },
    }
  );
  if (
    game?.preset !== "1991-default" ||
    !country?.ruFirstCouncilElectionCohortId?.equals(cohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("The first Council constitutional mandate changed");
  const opening = await db
    .collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION)
    .findOne(
      { _id: cohortId.toHexString() },
      {
        session,
        projection: {
          cohortId: 1,
          countryId: 1,
          preset: 1,
          mandateSinceTurn: 1,
          electionIds: 1,
          registeredBySubject: 1,
        },
      }
    );
  if (
    !opening ||
    opening.countryId !== "RU" ||
    opening.preset !== "1991-default" ||
    !opening.cohortId.equals(cohortId) ||
    opening.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    opening.electionIds.length !== 89 ||
    new Set(opening.electionIds.map((id) => id.toHexString())).size !== 89
  )
    throw new Error("Council certification needs the original complete opening");
  const boundaries = new Map(
    planRussianCouncilDistricts(opening.registeredBySubject).map((row) => [row.seatId, row])
  );
  const elections = db.collection<Election>("elections");
  const cohort = await elections
    .find(
      { countryId: "RU", "russianCouncilRound.cohortId": cohortId },
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
  if (
    cohort.length !== 89 ||
    new Set(cohort.map((row) => row.seatId)).size !== 89 ||
    cohort.some((row) => {
      const boundary = boundaries.get(row.seatId ?? "");
      return (
        !boundary ||
        row.electionType !== "federationCouncilMember" ||
        row.totalSeats !== 2 ||
        row.status !== "completed" ||
        !Number.isSafeInteger(row.endTurn) ||
        row.endTurn! > turn ||
        row.state !== boundary.regionId ||
        row.russianCouncilRound?.districtNumber !== boundary.districtNumber ||
        row.russianCouncilRound.registeredVoters !== boundary.registeredVoters ||
        row.russianCouncilRound.mandateSinceTurn !== opening.mandateSinceTurn ||
        !opening.electionIds[boundary.districtNumber - 1]?.equals(row._id)
      );
    })
  )
    throw new Error("The entire frozen Council cohort must finish before certification");
  const { ballots, counted, candidates, registeredCandidateIds } =
    await loadRussianCouncilCertificationInputs({ db, session, cohort, country });
  const result = resolveRussianCouncilCohort(ballots);
  const outcomes = new Map(result.map((row) => [row.electionId, row.decision.outcome]));
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const finalized = await tallies.bulkWrite(
    counted.map((row) => {
      const ballot = ballots.find((ballot) => ballot.id === row.electionId.toHexString())!;
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
                certifiedCohortId: cohortId,
              },
              updatedAt: now,
            },
          },
        },
      };
    }),
    { session }
  );
  if (finalized.matchedCount !== 89)
    throw new Error("Council tallies changed during certification");
  const resolved = await elections.updateMany(
    {
      _id: { $in: cohort.map((row) => row._id) },
      status: "completed",
      "russianCouncilRound.cohortId": cohortId,
    },
    { $set: { status: "resolved", resolving: false, updatedAt: now } },
    { session }
  );
  if (resolved.matchedCount !== 89) throw new Error("Council ballots changed during certification");
  const retired = await db.collection<ElectionCandidate>("electionCandidates").updateMany(
    {
      electionId: { $in: cohort.map((row) => row._id) },
      status: "active",
    },
    { $set: { status: "withdrawn", withdrawnAt: now } },
    { session }
  );
  if (retired.matchedCount !== candidates.filter((row) => row.status === "active").length)
    throw new Error("Council nominations changed during certification");
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstCouncilElectionCohortId: cohortId,
      ruFederalAssemblyMandateSinceTurn: opening.mandateSinceTurn,
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Council mandate changed during certification");
  const record: RussianCouncilResultRecord = {
    _id: cohortId.toHexString(),
    countryId: "RU",
    preset: "1991-default",
    cohortId,
    mandateSinceTurn: opening.mandateSinceTurn,
    resolvedOnTurn: turn,
    createdAt: now,
    result,
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
export function certifyRussianCouncilElection(
  input: Omit<Parameters<typeof materializeRussianCouncilElectionResult>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianCouncilElectionResult({ ...input, session }),
    { client: input.db.client }
  );
}
