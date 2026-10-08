/**
 * Closes the House vote that stays open after a contingent deadlock.
 *
 * Once the window has run its full length the standings decide: a delegation
 * majority elects that candidate president (the acting president becomes vice
 * president); otherwise the vote closes with no winner and the acting
 * president keeps serving. The close is claimed with a conditional update
 * before anything is seated, and a winner whose seating did not finish stays
 * flagged `seatingPending` so the next turn retries only the seating.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
import { createNotifications } from "@/lib/notifications";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { recordPresidentialTenure } from "@/lib/turn/election/presidentialTenureLedger";
import { loadHouseVoteStandings } from "@/lib/turn/election/contingentHouseVoteStandings";
import {
  isNppContingentId,
  toCharacterObjectId,
  toNppObjectId,
} from "@/lib/turn/election/contingentPersonIds";
import type { HouseVoteStandings } from "@/lib/elections/contingentHouseStandings";
import { logger } from "../../observability/logger";

type TallyWithVote = ElectionVoteTally & {
  contingentHouseVote: NonNullable<ElectionVoteTally["contingentHouseVote"]>;
};

async function seatHouseElectedPresident(
  db: Db,
  election: Election,
  tally: TallyWithVote,
  now: Date,
  turn: number
): Promise<boolean> {
  const vote = tally.contingentHouseVote;
  const winnerId = vote.presidentWinnerId;
  if (!winnerId) return false;
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const winnerCandidate = await db
    .collection<ElectionCandidate>("electionCandidates")
    .findOne({ _id: new ObjectId(winnerId) });
  if (!winnerCandidate) {
    logger.error(
      "Turn",
      `House vote ${election._id}: winner ${winnerId} has no candidacy; cannot seat`
    );
    await tallies.updateOne(
      { _id: tally._id },
      { $set: { "contingentHouseVote.seatingPending": false, updatedAt: now } }
    );
    return false;
  }

  // The acting president becomes the vice president.
  const actingIsNpp = isNppContingentId(vote.actingPresidentId);
  try {
    await seatPresidentialExecutive(db, {
      election,
      winnerCandidate,
      vpCharId: actingIsNpp ? undefined : toCharacterObjectId(vote.actingPresidentId),
      vpNppId: actingIsNpp ? toNppObjectId(vote.actingPresidentId) : undefined,
      now,
      turn,
    });
    await recordPresidentialTenure(
      db,
      election.countryId ?? "US",
      winnerCandidate.party,
      election._id.toString()
    );
  } catch (err) {
    logger.error("Turn", `House vote ${election._id}: seating failed, will retry next turn`, err);
    return false;
  }
  await tallies.updateOne(
    { _id: tally._id },
    { $set: { "contingentHouseVote.seatingPending": false, updatedAt: now } }
  );

  if (!winnerCandidate.isNPP && winnerCandidate.characterId) {
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: winnerCandidate.characterId }, { projection: { userId: 1 } });
    if (char?.userId) {
      await createNotifications([
        {
          userId: char.userId,
          type: "general_win",
          title: "Elected by the House",
          message: `The House of Representatives chose you as President. ${vote.actingPresidentName} becomes Vice President.`,
          metadata: { electionId: election._id.toString(), electionType: "president" },
        },
      ]).catch((err) => logger.error("Turn", "House vote notification failed", err));
    }
  }
  return true;
}

function closedWithWinnerUpdate(
  winnerId: string,
  standings: HouseVoteStandings,
  turn: number,
  now: Date,
  ballot: number
) {
  return {
    $set: {
      "contingentHouseVote.status": "closed" as const,
      "contingentHouseVote.closedTurn": turn,
      "contingentHouseVote.presidentWinnerId": winnerId,
      "contingentHouseVote.seatingPending": true,
      "contingentResult.presidentWinnerId": winnerId,
      "contingentResult.houseDeadlocked": false,
      "contingentResult.houseDelegationVotes": standings.delegationVotes,
      "contingentResult.houseVoteTotals": standings.delegationTotals,
      resolutionMode: "contingent" as const,
      updatedAt: now,
    },
    $push: {
      "contingentResult.houseBallots": {
        ballot,
        activeCandidateIds: Object.keys(standings.delegationTotals),
        delegationVotes: standings.delegationVotes,
        totals: standings.delegationTotals,
        reason: "House vote held after the deadlock",
      },
    },
  };
}

/**
 * Close at most one due House vote and finish at most one pending seating per
 * call (a world has a single US presidential election in flight). Returns how
 * many votes were closed or seated.
 */
export async function closeDueContingentHouseVotes(
  db: Db,
  now: Date,
  currentTurn: number
): Promise<number> {
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const elections = db.collection<Election>("elections");
  let handled = 0;

  const pending = (await tallies.findOne({
    "contingentHouseVote.seatingPending": true,
  })) as TallyWithVote | null;
  if (pending) {
    const election = await elections.findOne({ _id: pending.electionId });
    if (election && (election.countryId ?? "US") === "US") {
      if (await seatHouseElectedPresident(db, election, pending, now, currentTurn)) handled += 1;
    }
  }

  const due = (await tallies.findOne({
    "contingentHouseVote.status": "open",
    "contingentHouseVote.closesTurn": { $lte: currentTurn },
  })) as TallyWithVote | null;
  if (!due) return handled;
  const election = await elections.findOne({ _id: due.electionId });
  if (!election || (election.countryId ?? "US") !== "US") return handled;

  const standings = await loadHouseVoteStandings(db, election, due, due.contingentHouseVote);
  const winnerId = standings.majorityWinnerId;
  const claim = await tallies.updateOne(
    { _id: due._id, "contingentHouseVote.status": "open" },
    winnerId
      ? closedWithWinnerUpdate(
          winnerId,
          standings,
          currentTurn,
          now,
          (due.contingentResult?.houseBallots?.length ?? 0) + 1
        )
      : {
          $set: {
            "contingentHouseVote.status": "closed",
            "contingentHouseVote.closedTurn": currentTurn,
            updatedAt: now,
          },
        }
  );
  if (claim.modifiedCount !== 1) return handled;
  handled += 1;
  console.log(
    winnerId
      ? `[Turn] House vote ${election._id} closed: ${winnerId} elected president`
      : `[Turn] House vote ${election._id} closed with no majority; ${due.contingentHouseVote.actingPresidentName} keeps serving`
  );

  if (winnerId) {
    const claimed = (await tallies.findOne({ _id: due._id })) as TallyWithVote | null;
    if (claimed) await seatHouseElectedPresident(db, election, claimed, now, currentTurn);
  }
  return handled;
}
