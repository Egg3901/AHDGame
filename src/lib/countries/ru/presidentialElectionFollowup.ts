/**
 * A Russian presidential runoff counts a fresh ballot between its two finalists.
 * materializeRussianPresidentialFollowup opens that ballot or a new filing cycle
 * after a failed election, retaining the original registered electorate.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Campaign,
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
} from "@/lib/db/types";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { planRussianPresidentialBallot } from "./rules/presidentialSchedule";
import {
  RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION,
  type RussianPresidentialResultRecord,
} from "./presidentialElectionResult";

export async function materializeRussianPresidentialFollowup(input: {
  db: Db;
  session: ClientSession;
  predecessorElectionId: ObjectId;
  electionId: ObjectId;
  candidateIds: [ObjectId, ObjectId];
  turn: number;
  now: Date;
}): Promise<ObjectId | null> {
  const { db, session, predecessorElectionId, electionId, candidateIds, turn, now } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Russian followup needs an active transaction and time");
  const results = db.collection<RussianPresidentialResultRecord>(
    RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION
  );
  const result = await results.findOne(
    { _id: predecessorElectionId.toHexString(), preset: "1991-default", countryId: "RU" },
    { session }
  );
  if (!result || !result.electionId.equals(predecessorElectionId))
    throw new Error("Russian followup needs its certified predecessor result");
  if (result.decision.outcome === "won") return null;
  if (result.nextElectionId) return result.nextElectionId;
  if (!Number.isSafeInteger(turn) || turn < result.resolvedOnTurn)
    throw new Error("Russian followup cannot precede its result");
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RU", ruPresidencyMandateSinceTurn: result.mandateSinceTurn },
      { session, projection: { _id: 1 } }
    );
  if (!country) throw new Error("Russian followup mandate changed");
  const elections = db.collection<Election>("elections");
  const predecessor = await elections.findOne(
    { _id: predecessorElectionId, countryId: "RU", electionType: "president", status: "resolved" },
    { session, projection: { cycle: 1, electionYear: 1 } }
  );
  if (!predecessor) throw new Error("Russian followup predecessor is unresolved");
  const game = await db
    .collection<{
      _id: string;
      preset?: string;
      preIterationTurns?: number;
      preIteration?: { active?: boolean };
    }>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default")
    throw new Error("Russian followup belongs to a different world");
  const kind = result.decision.outcome === "runoff" ? "runoff" : "repeat";
  const timing = planRussianPresidentialBallot(turn, kind);
  const nextCandidates: ElectionCandidate[] = [];
  if (result.decision.outcome === "runoff") {
    if (candidateIds[0].equals(candidateIds[1]))
      throw new Error("Runoff candidates need distinct ids");
    const finalistIds = result.decision.finalistCandidateIds;
    const finalists = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find(
        {
          electionId: predecessorElectionId,
          _id: { $in: finalistIds.map((id) => new ObjectId(id)) },
          status: "active",
        },
        {
          session,
          projection: {
            characterId: 1,
            characterName: 1,
            countryId: 1,
            party: 1,
            isNPP: 1,
            nppId: 1,
            runningMateId: 1,
            russianRunningMateNppId: 1,
          },
        }
      )
      .toArray();
    if (finalists.length !== 2) throw new Error("Russian runoff finalists changed");
    for (let i = 0; i < 2; i++) {
      const finalist = finalists.find((c) => c._id.toHexString() === finalistIds[i])!;
      nextCandidates.push({
        _id: candidateIds[i],
        electionId,
        countryId: "RU",
        characterId: finalist.characterId,
        characterName: finalist.characterName,
        party: finalist.party,
        status: "active",
        russianTicketLocked: true,
        enteredAt: now,
        ...(finalist.isNPP ? { isNPP: true, nppId: finalist.nppId } : {}),
        ...(finalist.runningMateId ? { runningMateId: finalist.runningMateId } : {}),
        ...(finalist.russianRunningMateNppId
          ? { russianRunningMateNppId: finalist.russianRunningMateNppId }
          : {}),
      });
    }
  }
  const toTime = (boundary: number) => new Date(now.getTime() + (boundary - turn) * MS_PER_TURN);
  await elections.insertOne(
    {
      _id: electionId,
      countryId: "RU",
      electionType: "president",
      state: "RU",
      totalSeats: 1,
      cycle: predecessor.cycle,
      electionYear: turnToGameMonth(
        calendarTurn(timing.endTurn, {
          preIterationActive: game.preIteration?.active,
          preIterationTurns: game.preIterationTurns,
        }),
        1991
      ).year,
      status: "active",
      ...timing,
      startTime: now,
      primaryEndTime: toTime(timing.primaryEndTurn),
      endTime: toTime(timing.endTurn),
      russianPresidentialRound: {
        round: kind === "runoff" ? 2 : 1,
        mandateSinceTurn: result.mandateSinceTurn,
        registeredVoters: result.registeredVoters,
        predecessorElectionId,
      },
      createdAt: now,
      updatedAt: now,
    },
    { session }
  );
  if (nextCandidates.length) {
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .insertMany(nextCandidates, { session });
    await db.collection<Campaign>("campaigns").updateMany(
      {
        electionId: predecessorElectionId,
        candidateId: {
          $in: nextCandidates.map((candidate) =>
            candidate.isNPP ? candidate.nppId! : candidate.characterId
          ),
        },
        status: { $ne: "archived" },
      },
      { $set: { electionId, updatedAt: now } },
      { session }
    );
    await db.collection<ElectionVoteTally>("electionVoteTallies").insertOne(
      {
        _id: electionId,
        electionId,
        state: "RU",
        totalVotes: Object.fromEntries(nextCandidates.map((c) => [c._id.toHexString(), 0])),
        candidateNames: Object.fromEntries(
          nextCandidates.map((c) => [c._id.toHexString(), c.characterName])
        ),
        candidateParties: Object.fromEntries(
          nextCandidates.map((c) => [c._id.toHexString(), c.party])
        ),
        turnSnapshots: [],
        finalized: false,
        // Both certified finalists advance, even when they share a party.
        primaryResults: { byParty: {}, recordedAt: now },
        createdAt: now,
        updatedAt: now,
      },
      { session }
    );
  }
  const linked = await results.updateOne(
    { _id: result._id, nextElectionId: { $exists: false } },
    { $set: { nextElectionId: electionId } },
    { session }
  );
  if (linked.matchedCount !== 1) throw new Error("Russian followup was already opened");
  return electionId;
}
