import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  createNotification,
  createNotifications,
  type NotificationInput,
} from "@/lib/notifications";
import { NATIONAL_ELECTION_DURATION_TURNS } from "@/lib/nationalPartyElections";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import type {
  Caucus,
  CaucusChairCandidate,
  CaucusChairElection,
  CaucusChairVote,
  CaucusMembership,
  Character,
  NationalPartyElection,
} from "@/lib/db/types";

const CAUCUS_ELECTION_LABEL = "Caucus Chair";

function makePartyKey(countryId: string, partyId: string): string {
  return `${countryId}:${partyId}`;
}

async function listActivePlayerMembers(
  db: Db,
  caucusId: ObjectId
): Promise<Array<Pick<Character, "_id" | "userId">>> {
  const memberships = await db
    .collection<CaucusMembership>("caucusMemberships")
    .find({ caucusId, memberType: "character", status: "active" })
    .toArray();
  const memberIds = memberships.map((entry) => entry.memberId);
  if (memberIds.length === 0) return [];
  return db
    .collection<Character>("characters")
    .find({ _id: { $in: memberIds } })
    .toArray()
    .then((items) => items.map((entry) => ({ _id: entry._id, userId: entry.userId })));
}

async function notifyElectionOpened(caucus: Caucus): Promise<void> {
  const db = await getDb();
  const members = await listActivePlayerMembers(db, caucus._id);
  const inputs: NotificationInput[] = members.map((member) => ({
    userId: member.userId,
    type: "caucus_chair_election_opened",
    title: `${CAUCUS_ELECTION_LABEL} Election Open`,
    message:
      `A new ${CAUCUS_ELECTION_LABEL} election has opened for ${caucus.name}. ` +
      `Active caucus members may declare and vote for the next ${CAUCUS_ELECTION_LABEL}.`,
    metadata: {
      caucusId: caucus._id.toString(),
      partyId: caucus.partyId,
      recipientCharacterId: member._id.toString(),
    },
  }));
  await createNotifications(inputs);
}

async function notifyElectionWinner(
  caucus: Caucus,
  winnerId: ObjectId,
  winnerName: string
): Promise<void> {
  const db = await getDb();
  const winner = await db.collection<Character>("characters").findOne({ _id: winnerId });
  if (!winner) return;
  await createNotification({
    userId: winner.userId,
    type: "caucus_chair_elected",
    title: `You've been elected ${CAUCUS_ELECTION_LABEL}!`,
    message: `Congratulations, ${winnerName}! You have been elected ${CAUCUS_ELECTION_LABEL} of ${caucus.name}.`,
    metadata: { caucusId: caucus._id.toString(), partyId: caucus.partyId },
  });
}

async function notifyElectionLosses(
  caucus: Caucus,
  losers: CaucusChairCandidate[],
  winnerName: string
): Promise<void> {
  const db = await getDb();
  const inputs: NotificationInput[] = [];
  for (const loser of losers) {
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: loser.characterId });
    if (!character) continue;
    inputs.push({
      userId: character.userId,
      type: "caucus_chair_lost",
      title: `${CAUCUS_ELECTION_LABEL} Election Result`,
      message: `The ${caucus.name} ${CAUCUS_ELECTION_LABEL} election has concluded. ${winnerName} won the race.`,
      metadata: { caucusId: caucus._id.toString(), partyId: caucus.partyId },
    });
  }
  await createNotifications(inputs);
}

async function notifyChairRemoved(caucus: Caucus, previousChairId: ObjectId): Promise<void> {
  const db = await getDb();
  const previousChair = await db
    .collection<Character>("characters")
    .findOne({ _id: previousChairId });
  if (!previousChair) return;
  await createNotification({
    userId: previousChair.userId,
    type: "caucus_chair_removed",
    title: `Removed as ${CAUCUS_ELECTION_LABEL}`,
    message: `You have been replaced as ${CAUCUS_ELECTION_LABEL} of ${caucus.name} following the caucus election.`,
    metadata: { caucusId: caucus._id.toString(), partyId: caucus.partyId },
  });
}

/**
 * Create missing caucus-chair elections. Caucuses are anchored to the same live
 * 72-turn window as the parent party's national chair election so caucus
 * leadership stays synchronized with national party leadership turnover.
 */
export async function createMissingCaucusChairElections(currentTurn: number): Promise<number> {
  const db = await getDb();
  const now = new Date();

  const [caucuses, activeElections, activeNationalChairElections] = await Promise.all([
    db.collection<Caucus>("caucuses").find({ disbandedAt: null }).toArray(),
    db.collection<CaucusChairElection>("caucusChairElections").find({ status: "voting" }).toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find({ status: "voting", position: "chair" })
      .toArray(),
  ]);

  const activeSet = new Set(activeElections.map((entry) => entry.caucusId.toString()));
  const nationalByParty = new Map(
    activeNationalChairElections.map((entry) => [
      makePartyKey(entry.countryId ?? "US", entry.partyId),
      entry,
    ])
  );

  const toCreate = caucuses.filter((caucus) => !activeSet.has(caucus._id.toString()));
  if (toCreate.length === 0) return 0;

  const payloads: CaucusChairElection[] = toCreate.map((caucus) => {
    const anchor = nationalByParty.get(makePartyKey(caucus.countryId, caucus.partyId));
    const startTime = anchor?.startTime ?? now;
    const endTime =
      anchor?.endTime ??
      new Date(now.getTime() + NATIONAL_ELECTION_DURATION_TURNS * 60 * 60 * 1000);
    const startTurn = anchor?.startTurn ?? currentTurn;
    const endTurn = anchor?.endTurn ?? currentTurn + NATIONAL_ELECTION_DURATION_TURNS;
    return {
      _id: new ObjectId(),
      caucusId: caucus._id,
      partyId: caucus.partyId,
      countryId: caucus.countryId,
      status: "voting",
      startTime,
      endTime,
      startTurn,
      endTurn,
      durationTurns: anchor?.durationTurns ?? NATIONAL_ELECTION_DURATION_TURNS,
      winnerId: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  await db.collection<CaucusChairElection>("caucusChairElections").insertMany(payloads);
  await Promise.all(
    toCreate.map((caucus, index) =>
      Promise.all([
        db.collection<Caucus>("caucuses").updateOne(
          { _id: caucus._id },
          {
            $set: {
              nextElectionTurn: payloads[index].endTurn,
              updatedAt: now,
            },
          }
        ),
        notifyElectionOpened(caucus),
      ])
    )
  );

  return payloads.length;
}

/**
 * Resolve ended caucus-chair elections and update the caucus's seated chair plus
 * membership roles. Ties break toward the earliest declaration, matching party
 * leadership elections so caucus governance follows the same user expectations.
 */
export async function processCompletedCaucusChairElections(currentTurn: number): Promise<number> {
  const db = await getDb();
  const now = new Date();

  const endedElections = await db
    .collection<CaucusChairElection>("caucusChairElections")
    .find({ status: "voting", endTurn: { $lte: currentTurn } })
    .toArray();
  if (endedElections.length === 0) return 0;

  const electionIds = endedElections.map((entry) => entry._id);
  const caucusIds = endedElections.map((entry) => entry.caucusId);
  const bannedCharacterIds = await getBannedCharacterIds(db);
  const bannedVoterIds = [...bannedCharacterIds].map((id) => new ObjectId(id));

  const voteMatch: Record<string, unknown> = { electionId: { $in: electionIds } };
  if (bannedVoterIds.length > 0) {
    voteMatch.voterId = { $nin: bannedVoterIds };
  }

  const [caucuses, allCandidatesRaw, allVoteCounts] = await Promise.all([
    db
      .collection<Caucus>("caucuses")
      .find({ _id: { $in: caucusIds } })
      .toArray(),
    db
      .collection<CaucusChairCandidate>("caucusChairCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    db
      .collection<CaucusChairVote>("caucusChairVotes")
      .aggregate<{ electionId: ObjectId; candidateId: ObjectId; count: number }>([
        { $match: voteMatch },
        {
          $group: {
            _id: { electionId: "$electionId", candidateId: "$candidateId" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            electionId: "$_id.electionId",
            candidateId: "$_id.candidateId",
            count: 1,
          },
        },
      ])
      .toArray(),
  ]);

  const caucusMap = new Map(caucuses.map((entry) => [entry._id.toString(), entry]));
  const allCandidates = allCandidatesRaw.filter(
    (candidate) => !bannedCharacterIds.has(candidate.characterId.toString())
  );

  const candidatesByElection = new Map<string, CaucusChairCandidate[]>();
  for (const candidate of allCandidates) {
    const key = candidate.electionId.toString();
    const current = candidatesByElection.get(key) ?? [];
    current.push(candidate);
    candidatesByElection.set(key, current);
  }

  const activeCharIdsByElection = new Map<string, Set<string>>();
  for (const candidate of allCandidates) {
    const key = candidate.electionId.toString();
    let set = activeCharIdsByElection.get(key);
    if (!set) {
      set = new Set<string>();
      activeCharIdsByElection.set(key, set);
    }
    set.add(candidate.characterId.toString());
  }

  const voteCountsByElection = new Map<string, { candidateId: ObjectId; count: number }[]>();
  for (const vote of allVoteCounts) {
    const key = vote.electionId.toString();
    if (!activeCharIdsByElection.get(key)?.has(vote.candidateId.toString())) continue;
    const current = voteCountsByElection.get(key) ?? [];
    current.push({ candidateId: vote.candidateId, count: vote.count });
    voteCountsByElection.set(key, current);
  }
  for (const values of voteCountsByElection.values()) {
    values.sort((a, b) => b.count - a.count);
  }

  const electionBulkOps: Array<{
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }> = [];

  for (const election of endedElections) {
    const candidates = candidatesByElection.get(election._id.toString()) ?? [];
    const voteCounts = voteCountsByElection.get(election._id.toString()) ?? [];
    const caucus = caucusMap.get(election.caucusId.toString());
    if (!caucus) continue;

    let winnerId: ObjectId | null = null;
    let winnerName: string | null = null;

    if (candidates.length > 0 && voteCounts.length > 0) {
      const topCount = voteCounts[0].count;
      const tied = voteCounts.filter((entry) => entry.count === topCount);
      if (tied.length === 1) {
        winnerId = tied[0].candidateId;
      } else {
        const tiedCandidates = candidates
          .filter((candidate) =>
            tied.some((entry) => entry.candidateId.equals(candidate.characterId))
          )
          .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
        if (tiedCandidates.length > 0) winnerId = tiedCandidates[0].characterId;
      }

      const winnerCandidate = candidates.find((candidate) =>
        candidate.characterId.equals(winnerId!)
      );
      winnerName = winnerCandidate?.characterName ?? "Unknown";
    }

    electionBulkOps.push({
      updateOne: {
        filter: { _id: election._id },
        update: { $set: { status: "completed", winnerId, updatedAt: now } },
      },
    });

    if (!winnerId || !winnerName) continue;

    const previousChairId = caucus.chairId;
    await db.collection<Caucus>("caucuses").updateOne(
      { _id: caucus._id },
      {
        $set: {
          chairId: winnerId,
          lastElectedTurn: currentTurn,
          nextElectionTurn: currentTurn + NATIONAL_ELECTION_DURATION_TURNS,
          updatedAt: now,
        },
        $inc: { termsServed: 1 },
      }
    );

    await db
      .collection<CaucusMembership>("caucusMemberships")
      .updateMany(
        { caucusId: caucus._id, memberType: "character", role: "chair", status: "active" },
        { $set: { role: "member", updatedAt: now } }
      );
    await db
      .collection<CaucusMembership>("caucusMemberships")
      .updateOne(
        { caucusId: caucus._id, memberType: "character", memberId: winnerId, status: "active" },
        { $set: { role: "chair", updatedAt: now } }
      );

    await notifyElectionWinner(caucus, winnerId, winnerName);
    await notifyElectionLosses(
      caucus,
      candidates.filter((candidate) => !candidate.characterId.equals(winnerId)),
      winnerName
    );
    if (previousChairId && !previousChairId.equals(winnerId)) {
      await notifyChairRemoved(caucus, previousChairId);
    }
  }

  if (electionBulkOps.length > 0) {
    await db.collection<CaucusChairElection>("caucusChairElections").bulkWrite(electionBulkOps);
  }

  return endedElections.length;
}

export async function processCaucusChairElections(currentTurn: number): Promise<{
  electionsCreated: number;
  electionsCompleted: number;
}> {
  try {
    const electionsCompleted = await processCompletedCaucusChairElections(currentTurn);
    const electionsCreated = await createMissingCaucusChairElections(currentTurn);
    return { electionsCreated, electionsCompleted };
  } catch (error) {
    console.error("[CaucusChairElections] Error:", error);
    return { electionsCreated: 0, electionsCompleted: 0 };
  }
}
