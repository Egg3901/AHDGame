/** Brazil's popular or modeled congressional ballot, followed by shared executive seating. */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  ElectedOfficial,
} from "@/lib/db/types";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { captureElectionResultSnapshot } from "@/lib/elections/liveResults/captureResultSnapshot";
import { initElectionVoteTally } from "@/lib/electionEngine/tallyManagement";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { brazilPresidentialRules, decideBrazilPresidency } from "./rules/presidential";

const followupId = (source: string) =>
  new ObjectId(
    createHash("sha256").update(`BR-presidential-runoff:${source}`).digest("hex").slice(0, 24)
  );

export async function resolveBrazilPresidentialElection(
  db: Db,
  election: Election,
  tally: ElectionVoteTally | null,
  now: Date,
  turn: number
): Promise<boolean> {
  if (tally?.finalized && !tally.executiveSeatingPending) {
    await db.collection("campaigns").deleteMany({ electionId: election._id });
    await captureElectionResultSnapshot(db, election, now);
    return true;
  }
  const game = await db
    .collection<{ _id: string; preset: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (!game?.preset) throw new Error("Brazil presidency requires the active preset");
  const mode = election.brazilPresidentialMode ?? brazilPresidentialRules(game.preset).mode;
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: election._id,
      ...(tally?.brazilPresidentialResult ? {} : { status: "active" }),
    })
    .toArray();
  let votes = tally?.totalVotes ?? {};
  if (mode === "indirect" && !tally?.brazilPresidentialResult) {
    // The game models Congress as the college. Federal-state delegations are
    // not represented; do not label this count a popular ballot.
    const legislators = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: "BR", officeType: { $in: ["chamber", "senate"] } },
        { projection: { party: 1, seatsHeld: 1, characterId: 1, nppId: 1 } }
      )
      .toArray();
    votes = Object.fromEntries(
      candidates.map((c) => [
        String(c._id),
        legislators
          .filter((o) => o.party === c.party && (o.characterId || o.nppId))
          .reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0),
      ])
    );
  }
  const validVotes = Object.fromEntries(
    candidates.map((c) => [String(c._id), votes[String(c._id)] ?? 0])
  );
  const decision =
    tally?.brazilPresidentialResult ??
    decideBrazilPresidency(validVotes, mode, election.brazilPresidentialRound ?? 1);
  if (decision.outcome === "indeterminate") return false;
  if (!tally) {
    await initElectionVoteTally(election._id, candidates, "BR", { byParty: {}, recordedAt: now });
  }
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id },
    {
      $set: {
        brazilPresidentialResult: decision,
        totalVotes: validVotes,
        executiveSeatingPending: true,
        updatedAt: now,
      },
    }
  );
  if (decision.outcome === "runoff") {
    const electionId = followupId(String(election._id));
    const finalists = decision.finalistIds.map((id) =>
      candidates.find((c) => String(c._id) === id)
    );
    if (finalists.some((c) => !c)) throw new Error("Brazil runoff lost a certified finalist");
    // Release the old active candidacies before opening the fresh ballot.
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { electionId: election._id, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    const nextCandidates = finalists.map((c) => ({
      ...c!,
      _id: followupId(String(c!._id)),
      electionId,
      status: "active" as const,
      enteredAt: now,
    }));
    for (const candidate of nextCandidates)
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
    const existingTally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId });
    if (!existingTally)
      await initElectionVoteTally(electionId, nextCandidates, "BR", {
        byParty: {},
        recordedAt: now,
      });
    await db.collection<Election>("elections").updateOne(
      { _id: electionId },
      {
        $setOnInsert: {
          ...election,
          _id: electionId,
          status: "active",
          resolving: false,
          brazilPresidentialRound: 2,
          brazilPresidentialPredecessorId: election._id,
          startTurn: turn,
          primaryEndTurn: turn,
          endTurn: turn + 24,
          startTime: now,
          primaryEndTime: now,
          endTime: new Date(now.getTime() + 24 * MS_PER_TURN),
          durationHours: 24,
          primaryDurationHours: 0,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  } else {
    const winner = candidates.find((c) => String(c._id) === decision.winnerId);
    if (!winner) throw new Error("Brazil presidential winner missing");
    await seatPresidentialExecutive(db, {
      election,
      winnerCandidate: winner,
      vpCharId: winner.runningMateId,
      now,
      turn,
    });
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { electionId: election._id, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
  }
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id },
    {
      $set: {
        finalized: true,
        executiveSeatingPending: false,
        resolvedAtTurn: turn,
        updatedAt: now,
      },
    }
  );
  await db.collection("campaigns").deleteMany({ electionId: election._id });
  await captureElectionResultSnapshot(db, election, now);
  return true;
}
