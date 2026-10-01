/**
 * First-Duma certification counts both tiers together and records vacancies.
 * materializeRussianDumaElectionResult freezes one complete cohort atomically,
 * validates owners in batches and preserves Congress until a separate handover.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
  NPP,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { resolveRussianDumaCohort, type RussianDumaCohortBallot } from "./rules/assemblyCohort";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export const RUSSIAN_DUMA_RESULTS_COLLECTION = "russianDumaElectionResults";
export interface RussianDumaResultRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  cohortId: ObjectId;
  mandateSinceTurn: number;
  resolvedOnTurn: number;
  createdAt: Date;
  result: ReturnType<typeof resolveRussianDumaCohort>;
  votesByElection: Record<string, { votes: Record<string, number>; againstAllVotes: number }>;
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
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId?.equals(cohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("The first-Duma constitutional mandate changed");
  const elections = db.collection<Election>("elections");
  const cohort = await elections
    .find(
      { countryId: "RU", "russianDumaRound.cohortId": cohortId },
      {
        session,
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
        row.totalSeats !== (row.russianDumaRound?.tier === "list" ? 225 : 1)
    )
  )
    throw new Error("The entire first-Duma cohort must finish before certification");
  const electionIds = cohort.map((row) => row._id);
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const counted = await tallies
    .find(
      { electionId: { $in: electionIds } },
      {
        session,
        projection: {
          electionId: 1,
          finalized: 1,
          totalVotes: 1,
          candidateParties: 1,
          russianDumaBallot: 1,
        },
      }
    )
    .toArray();
  if (
    counted.length !== 226 ||
    new Set(counted.map((row) => row.electionId.toHexString())).size !== 226 ||
    counted.some((row) => row.finalized || row.russianDumaBallot?.certifiedCohortId)
  )
    throw new Error("The Duma needs 226 unique unfinalized tallies");
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: electionIds } },
      {
        session,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          characterName: 1,
          party: 1,
          countryId: 1,
          status: 1,
          russianDumaNomination: 1,
        },
      }
    )
    .toArray();
  const npcIds = candidates.filter((row) => row.isNPP && row.nppId).map((row) => row.nppId!);
  const playerIds = candidates.filter((row) => !row.isNPP).map((row) => row.characterId);
  const npcs = npcIds.length
    ? await db
        .collection<NPP>("npps")
        .find(
          {
            _id: { $in: npcIds },
            countryId: "RU",
            $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
            isTechnocrat: { $ne: true },
          },
          { session, projection: { party: 1 } }
        )
        .toArray()
    : [];
  const players = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: playerIds },
            countryId: "RU",
            federationPendingResidenceId: { $exists: false },
          },
          { session, projection: { party: 1, homeState: 1 } }
        )
        .toArray()
    : [];
  const owners = new Map<string, { party: string; homeState?: string }>([
    ...npcs.map(
      (row) => [`npc:${row._id.toHexString()}`, { party: row.party, homeState: undefined }] as const
    ),
    ...players.map(
      (row) =>
        [`player:${row._id.toHexString()}`, { party: row.party, homeState: row.homeState }] as const
    ),
  ]);
  const rosterByElection = new Map<string, ElectionCandidate[]>();
  for (const candidate of candidates) {
    const id = candidate.electionId.toHexString();
    const roster = rosterByElection.get(id) ?? [];
    roster.push(candidate);
    rosterByElection.set(id, roster);
  }
  const tallyByElection = new Map(counted.map((row) => [row.electionId.toHexString(), row]));
  const votesByElection: RussianDumaResultRecord["votesByElection"] = {};
  const ballots: RussianDumaCohortBallot[] = cohort.map((election) => {
    const id = election._id.toHexString();
    const tally = tallyByElection.get(id)!;
    const roster = rosterByElection.get(id) ?? [];
    const keys = roster
      .map((row) => row._id.toHexString())
      .sort()
      .join(",");
    if (
      Object.keys(tally.totalVotes).sort().join(",") !== keys ||
      Object.keys(tally.candidateParties).sort().join(",") !== keys ||
      roster.some(
        (row) =>
          row.countryId !== "RU" ||
          !row.russianDumaNomination ||
          row.party !== tally.candidateParties[row._id.toHexString()] ||
          (row.isNPP && !row.nppId)
      )
    )
      throw new Error("The Duma tally does not match its frozen nominee roster");
    const againstAllVotes = tally.russianDumaBallot?.againstAllVotes ?? 0;
    votesByElection[id] = { votes: { ...tally.totalVotes }, againstAllVotes };
    return {
      id,
      seatId: election.seatId!,
      regionId: election.state!,
      tier: election.russianDumaRound!.tier,
      registeredVoters: election.russianDumaRound!.registeredVoters,
      againstAllVotes,
      invalidated: tally.russianDumaBallot?.invalidated,
      candidates: roster.map((row) => {
        const ownerId = row.isNPP ? row.nppId! : row.characterId;
        const owner = owners.get(`${row.isNPP ? "npc" : "player"}:${ownerId.toHexString()}`);
        return {
          id: row._id.toHexString(),
          ownerId: ownerId.toHexString(),
          party: row.party,
          votes: tally.totalVotes[row._id.toHexString()],
          ...row.russianDumaNomination!,
          isNpc: !!row.isNPP,
          eligible:
            row.status === "active" &&
            owner?.party === row.party &&
            (!!row.isNPP ||
              election.russianDumaRound!.tier === "list" ||
              owner?.homeState === election.state),
        };
      }),
    };
  });
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
  // Take a write conflict on the bound mandate without activating the Assembly.
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstDumaElectionCohortId: cohortId,
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
    nominees: candidates.map((row) => ({
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
