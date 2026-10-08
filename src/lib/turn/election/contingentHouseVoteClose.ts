/**
 * Ballots the House vote that stays open after a contingent deadlock.
 *
 * Like the real House, it ballots again every turn: the moment a candidate
 * holds a majority of state delegations the House has chosen, that candidate
 * becomes president and the acting president becomes vice president. The first
 * ballot that counts is the turn after the vote opened. If the window passes
 * with no majority the vote closes with no winner and the acting president
 * keeps serving. Each ballot is claimed with a conditional update before
 * anything is seated, and a winner whose seating did not finish stays flagged
 * `seatingPending` so the next turn retries only the seating.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import { createNotifications } from "@/lib/notifications";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { recordPresidentialTenure } from "@/lib/turn/election/presidentialTenureLedger";
import {
  loadHouseVoteStandings,
  type LiveHouseVoteStandings,
} from "@/lib/turn/election/contingentHouseVoteStandings";
import {
  notifyHouseVoteClosed,
  notifyHouseVoteReminder,
} from "@/lib/turn/election/contingentHouseVoteNotices";
import {
  isNppContingentId,
  toCharacterObjectId,
  toNppObjectId,
} from "@/lib/turn/election/contingentPersonIds";
import { logger } from "../../observability/logger";

type TallyWithVote = ElectionVoteTally & {
  contingentHouseVote: NonNullable<ElectionVoteTally["contingentHouseVote"]>;
};

async function actingPersonPresent(db: Db, personId: string): Promise<boolean> {
  if (isNppContingentId(personId)) {
    const npp = await db
      .collection<NPP>("npps")
      .findOne({ _id: toNppObjectId(personId) }, { projection: { retiredAt: 1 } });
    return Boolean(npp && !npp.retiredAt);
  }
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: toCharacterObjectId(personId) }, { projection: { _id: 1 } });
  return Boolean(char);
}

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

  // The acting president becomes the vice president, unless they have left
  // the game since: the vice presidency then stays vacant.
  const actingIsNpp = isNppContingentId(vote.actingPresidentId);
  const actingPresent = await actingPersonPresent(db, vote.actingPresidentId);
  try {
    await seatPresidentialExecutive(db, {
      election,
      winnerCandidate,
      vpCharId:
        actingPresent && !actingIsNpp ? toCharacterObjectId(vote.actingPresidentId) : undefined,
      vpNppId: actingPresent && actingIsNpp ? toNppObjectId(vote.actingPresidentId) : undefined,
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

function ballotEntry(standings: LiveHouseVoteStandings, turn: number) {
  return {
    turn,
    delegationVotes: standings.delegationVotes,
    totals: standings.delegationTotals,
    winnerId: standings.majorityWinnerId,
  };
}

function sameBallot(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  return true;
}

function closedWithWinnerUpdate(
  winnerId: string,
  standings: LiveHouseVoteStandings,
  turn: number,
  now: Date,
  ballot: number
) {
  return {
    $set: {
      "contingentHouseVote.status": "closed" as const,
      "contingentHouseVote.closedTurn": turn,
      "contingentHouseVote.lastBallotTurn": turn,
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
      "contingentHouseVote.ballots": ballotEntry(standings, turn),
      "contingentResult.houseBallots": {
        ballot,
        activeCandidateIds: standings.activeCandidateIds,
        delegationVotes: standings.delegationVotes,
        totals: standings.delegationTotals,
        reason: "House vote held after the deadlock",
      },
    },
  };
}

/**
 * Take this turn's ballot of every open House vote past its first turn, and
 * finish at most one pending seating. Returns how many ballots were taken or
 * seatings finished.
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

  // The vote opens during a turn; the first ballot that counts is the next one.
  const due = (await tallies
    .find({
      "contingentHouseVote.status": "open",
      "contingentHouseVote.openedTurn": { $lt: currentTurn },
      "contingentHouseVote.lastBallotTurn": { $ne: currentTurn },
    })
    .toArray()) as TallyWithVote[];

  for (const tally of due) {
    const election = await elections.findOne({ _id: tally.electionId });
    if (!election || (election.countryId ?? "US") !== "US") continue;
    try {
      if (await takeBallot(db, election, tally, now, currentTurn)) handled += 1;
    } catch (err) {
      logger.error("Turn", `House vote ${election._id}: ballot failed, will retry next turn`, err);
    }
  }
  return handled;
}

async function takeBallot(
  db: Db,
  election: Election,
  tally: TallyWithVote,
  now: Date,
  currentTurn: number
): Promise<boolean> {
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const vote = tally.contingentHouseVote;
  const standings = await loadHouseVoteStandings(db, election, tally, vote);
  const winnerId = standings.majorityWinnerId;
  const windowOver = currentTurn >= vote.closesTurn;
  const entry = ballotEntry(standings, currentTurn);

  const update = winnerId
    ? closedWithWinnerUpdate(
        winnerId,
        standings,
        currentTurn,
        now,
        (tally.contingentResult?.houseBallots?.length ?? 0) + 1
      )
    : {
        $set: {
          "contingentHouseVote.lastBallotTurn": currentTurn,
          ...(windowOver
            ? {
                "contingentHouseVote.status": "closed" as const,
                "contingentHouseVote.closedTurn": currentTurn,
              }
            : {}),
          updatedAt: now,
        },
        $push: { "contingentHouseVote.ballots": entry },
      };
  const claim = await tallies.updateOne(
    {
      _id: tally._id,
      "contingentHouseVote.status": "open",
      "contingentHouseVote.lastBallotTurn": { $ne: currentTurn },
    },
    update
  );
  if (claim.modifiedCount !== 1) return false;

  const nameOf = (id: string) => tally.candidateNames?.[id] ?? id;
  if (winnerId) {
    console.log(`[Turn] House vote ${election._id} closed: ${winnerId} elected president`);
    const claimed = (await tallies.findOne({ _id: tally._id })) as TallyWithVote | null;
    if (claimed) await seatHouseElectedPresident(db, election, claimed, now, currentTurn);
    await notifyHouseVoteClosed(db, election, vote, {
      winnerName: nameOf(winnerId),
      delegations: standings.delegationTotals[winnerId] ?? 0,
      threshold: standings.threshold,
    }).catch((err) => logger.error("Turn", "House vote close notice failed", err));
  } else if (windowOver) {
    console.log(
      `[Turn] House vote ${election._id} closed with no majority; ${vote.actingPresidentName} keeps serving`
    );
    await notifyHouseVoteClosed(db, election, vote, {
      winnerName: null,
      delegations: 0,
      threshold: standings.threshold,
    }).catch((err) => logger.error("Turn", "House vote close notice failed", err));
  } else {
    // Remind members who have not voted, once per turn and only when the
    // board moved since the previous ballot.
    const previous =
      vote.ballots?.[vote.ballots.length - 1]?.delegationVotes ??
      tally.contingentResult?.houseDelegationVotes ??
      {};
    if (!sameBallot(previous, standings.delegationVotes)) {
      const reminder = await tallies.updateOne(
        { _id: tally._id, "contingentHouseVote.lastReminderTurn": { $ne: currentTurn } },
        { $set: { "contingentHouseVote.lastReminderTurn": currentTurn } }
      );
      if (reminder.modifiedCount === 1) {
        const leaderId = standings.leaderId;
        await notifyHouseVoteReminder(
          db,
          election,
          vote,
          {
            leaderName: leaderId ? nameOf(leaderId) : null,
            leaderDelegations: leaderId ? (standings.delegationTotals[leaderId] ?? 0) : 0,
            threshold: standings.threshold,
          },
          currentTurn
        ).catch((err) => logger.error("Turn", "House vote reminder failed", err));
      }
    }
  }
  return true;
}
