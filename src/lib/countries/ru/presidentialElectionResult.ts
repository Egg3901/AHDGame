/**
 * Russian presidential results certify the counted national ballot transactionally.
 * materializeRussianPresidentialElectionResult binds the result to its enacted
 * mandate and preserves existing office holders until a separate certified handover.
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
import {
  decideRussianPresidentialResult,
  type RussianPresidentialResult,
} from "./rules/presidentialResult";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
export const RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION = "russianPresidentialElectionResults";
export interface RussianPresidentialResultRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  electionId: ObjectId;
  mandateSinceTurn: number;
  round: 1 | 2;
  registeredVoters: number;
  participants: number;
  votesFor: Record<string, number>;
  decision: RussianPresidentialResult;
  resolvedOnTurn: number;
  createdAt: Date;
  nextElectionId?: ObjectId;
  seatedOnTurn?: number;
  vicePresident?: { characterId?: ObjectId; nppId?: ObjectId; name: string; party: string };
  winner?: {
    candidateId: ObjectId;
    characterId?: ObjectId;
    nppId?: ObjectId;
    name: string;
    party: string;
    runningMateId?: ObjectId;
  };
}
export async function materializeRussianPresidentialElectionResult(input: {
  db: Db;
  session: ClientSession;
  electionId: ObjectId;
  turn: number;
  now: Date;
}): Promise<RussianPresidentialResultRecord> {
  const { db, session, electionId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Russian result certification needs a transaction, turn and time");
  const results = db.collection<RussianPresidentialResultRecord>(
    RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION
  );
  const previous = await results.findOne({ _id: electionId.toHexString() }, { session });
  if (previous) {
    if (previous.countryId !== "RU" || !previous.electionId.equals(electionId))
      throw new Error("Russian result identity changed");
    return previous;
  }
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default")
    throw new Error("No 1991 Russian presidential mandate in this world");
  const elections = db.collection<Election>("elections");
  const election = await elections.findOne(
    { _id: electionId, countryId: "RU", electionType: "president", status: "completed" },
    { session, projection: { russianPresidentialRound: 1, endTurn: 1 } }
  );
  const binding = election?.russianPresidentialRound;
  if (!binding || !Number.isSafeInteger(election?.endTurn) || election!.endTurn! > turn)
    throw new Error("Russian presidential ballot is not bound or completed");
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    { session, projection: { ruSovietSuccessionSinceTurn: 1, ruPresidencyMandateSinceTurn: 1 } }
  );
  if (
    !country ||
    country.ruPresidencyMandateSinceTurn !== binding.mandateSinceTurn ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruPresidencyMandateSinceTurn
    )
  )
    throw new Error("Russian presidential constitutional mandate changed");
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  let tally = await tallies.findOne(
    { electionId, finalized: { $ne: true } },
    { session, projection: { totalVotes: 1, candidateParties: 1 } }
  );
  if (!tally) {
    if (await tallies.findOne({ electionId }, { session, projection: { _id: 1 } }))
      throw new Error("Russian tally was finalized without a certified result");
    const roster = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find(
        { electionId, status: "active" },
        { session, projection: { characterName: 1, party: 1 } }
      )
      .toArray();
    tally = {
      _id: electionId,
      electionId,
      state: "RU",
      totalVotes: Object.fromEntries(roster.map((c) => [c._id.toHexString(), 0])),
      candidateNames: Object.fromEntries(roster.map((c) => [c._id.toHexString(), c.characterName])),
      candidateParties: Object.fromEntries(roster.map((c) => [c._id.toHexString(), c.party])),
      turnSnapshots: [],
      finalized: false,
      createdAt: now,
      updatedAt: now,
    };
    await tallies.insertOne(tally, { session });
  }
  const candidateIds = Object.keys(tally.candidateParties);
  if (
    candidateIds.some((id) => !ObjectId.isValid(id) || new ObjectId(id).toHexString() !== id) ||
    Object.keys(tally.totalVotes).sort().join(",") !== [...candidateIds].sort().join(",")
  )
    throw new Error("Russian presidential tally does not match its registered roster");
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId, _id: { $in: candidateIds.map((id) => new ObjectId(id)) } },
      {
        session,
        projection: {
          characterId: 1,
          characterName: 1,
          party: 1,
          countryId: 1,
          status: 1,
          isNPP: 1,
          nppId: 1,
          runningMateId: 1,
          russianRunningMateNppId: 1,
        },
      }
    )
    .toArray();
  const participants = Object.values(tally.totalVotes).reduce((sum, votes) => sum + votes, 0);
  let decision = decideRussianPresidentialResult({
    round: binding.round,
    candidateIds,
    votesFor: tally.totalVotes,
    votesAgainst: Object.fromEntries(
      candidateIds.map((id) => [id, participants - tally.totalVotes[id]])
    ),
    registeredVoters: binding.registeredVoters,
    participants,
    invalidated:
      candidates.length !== candidateIds.length ||
      candidates.some(
        (candidate) =>
          candidate.status !== "active" ||
          candidate.party !== tally.candidateParties[candidate._id.toHexString()] ||
          (candidate.countryId != null && candidate.countryId !== "RU")
      ),
  });
  const record: RussianPresidentialResultRecord = {
    _id: electionId.toHexString(),
    countryId: "RU",
    preset: "1991-default",
    electionId,
    mandateSinceTurn: binding.mandateSinceTurn,
    round: binding.round,
    registeredVoters: binding.registeredVoters,
    participants,
    votesFor: { ...tally.totalVotes },
    decision,
    resolvedOnTurn: turn,
    createdAt: now,
  };
  if (decision.outcome === "won") {
    const winner = candidates.find(
      (candidate) => candidate._id.toHexString() === decision.winnerCandidateId
    )!;
    const ownerId = winner.isNPP ? winner.nppId : winner.characterId;
    if (!ownerId) throw new Error("Russian presidential winner has no owner");
    const owner = winner.isNPP
      ? await db.collection<NPP>("npps").findOne(
          {
            _id: ownerId,
            countryId: "RU",
            $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
          },
          { session, projection: { _id: 1 } }
        )
      : await db
          .collection<Character>("characters")
          .findOne({ _id: ownerId, countryId: "RU" }, { session, projection: { _id: 1 } });
    const mateId = winner.runningMateId ?? winner.russianRunningMateNppId;
    const mateIsNpp = !winner.runningMateId;
    const samePerson = !!mateId && mateId.equals(ownerId) && mateIsNpp === !!winner.isNPP;
    const mate =
      mateId && !samePerson
        ? mateIsNpp
          ? await db.collection<NPP>("npps").findOne(
              {
                _id: mateId,
                countryId: "RU",
                $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
                isTechnocrat: { $ne: true },
              },
              { session, projection: { name: 1, party: 1 } }
            )
          : await db
              .collection<Character>("characters")
              .findOne(
                { _id: mateId, countryId: "RU" },
                { session, projection: { name: 1, party: 1 } }
              )
        : null;
    if (!owner || !mate) {
      decision = { outcome: "repeat", reason: "invalid-ballot" };
      record.decision = decision;
    } else {
      record.vicePresident = {
        ...(mateIsNpp ? { nppId: mateId! } : { characterId: mateId! }),
        name: mate.name,
        party: mate.party,
      };
      record.winner = {
        candidateId: winner._id,
        ...(winner.isNPP ? { nppId: ownerId } : { characterId: ownerId }),
        name: winner.characterName,
        party: winner.party,
        ...(winner.runningMateId ? { runningMateId: winner.runningMateId } : {}),
      };
      const certified = await countries.updateOne(
        { _id: "RU", ruPresidencyMandateSinceTurn: binding.mandateSinceTurn },
        {
          $set: {
            ruPresidencyElectionCertifiedSinceTurn: turn,
            ruPresidencyCertifiedElectionId: electionId,
            updatedAt: now,
          },
        },
        { session }
      );
      if (certified.matchedCount !== 1)
        throw new Error("Russian presidential mandate changed during certification");
    }
  }
  const finalized = await tallies.updateOne(
    { electionId, finalized: { $ne: true } },
    {
      $set: {
        finalized: true,
        russianPresidentialResult: {
          outcome: decision.outcome,
          ...(decision.outcome === "won" ? { winnerCandidateId: decision.winnerCandidateId } : {}),
          round: binding.round,
          registeredVoters: binding.registeredVoters,
          participants,
        },
        updatedAt: now,
      },
    },
    { session }
  );
  if (finalized.matchedCount !== 1)
    throw new Error("Russian presidential tally changed during certification");
  const resolved = await elections.updateOne(
    { _id: electionId, status: "completed" },
    { $set: { status: "resolved", resolving: false, updatedAt: now } },
    { session }
  );
  if (resolved.matchedCount !== 1)
    throw new Error("Russian presidential ballot changed during certification");
  await results.insertOne(record, { session });
  return record;
}
export async function certifyRussianPresidentialElection(
  input: Omit<Parameters<typeof materializeRussianPresidentialElectionResult>[0], "session">
) {
  return runRequiredTransaction(
    (session) => materializeRussianPresidentialElectionResult({ ...input, session }),
    { client: input.db.client }
  );
}
