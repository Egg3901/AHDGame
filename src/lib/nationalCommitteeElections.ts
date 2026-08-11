import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createNotification, createNotifications } from "@/lib/notifications";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import { expireOpenProposals } from "@/lib/parties/proposals";
import { expirePendingTransactions } from "@/lib/parties/pendingTreasuryTransactions";
import { reconcileAllCoalitionChairs } from "@/lib/coalitions/syncCoalitionChair";
import type {
  NationalCommitteeElection,
  NationalCommitteeVote,
  NationalCommitteeCandidate,
  PoliticalParty,
  Character,
} from "@/lib/db/types";
import { DEFAULT_LEGACY_COUNTRY_ID, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { createTurnBackedWindow } from "@/lib/time/turnBackedWindow";

export const COMMITTEE_ELECTION_DURATION_TURNS = 168; // 168 turns = 1 week
export const COMMITTEE_SIZE = 6; // Maximum committee members
export const MAX_VOTES_PER_VOTER = 6; // Each voter can vote for up to 6 candidates

function dedupeCommitteeVotes(votes: NationalCommitteeVote[]): NationalCommitteeVote[] {
  const latestByVoter = new Map<string, NationalCommitteeVote>();

  for (const vote of votes) {
    const key = `${vote.electionId.toString()}:${vote.voterId.toString()}`;
    const existing = latestByVoter.get(key);
    if (!existing) {
      latestByVoter.set(key, vote);
      continue;
    }

    const existingTime = existing.votedAt?.getTime() ?? 0;
    const nextTime = vote.votedAt?.getTime() ?? 0;
    if (
      nextTime > existingTime ||
      (nextTime === existingTime && vote._id.toString() > existing._id.toString())
    ) {
      latestByVoter.set(key, vote);
    }
  }

  return [...latestByVoter.values()];
}

async function findPartyByElectionPartyId(
  db: Db,
  partyId: string,
  countryId: CountryId
): Promise<PoliticalParty | null> {
  const sequentialId = Number.parseInt(partyId, 10);
  if (Number.isNaN(sequentialId)) {
    return null;
  }
  // Always use countryId to find the correct party (sequentialId is only unique within a country)
  return db.collection<PoliticalParty>("politicalParties").findOne({ sequentialId, countryId });
}

function applyOptionalCountryScope(
  baseQuery: Record<string, unknown>,
  countryId?: CountryId
): Record<string, unknown> {
  if (!countryId) return baseQuery;

  const countryQuery: Record<string, unknown> =
    countryId === DEFAULT_LEGACY_COUNTRY_ID
      ? {
          $or: [{ countryId: DEFAULT_LEGACY_COUNTRY_ID }, { countryId: { $exists: false } }],
        }
      : { countryId };

  if (Object.keys(baseQuery).length === 0) {
    return countryQuery;
  }

  return { $and: [baseQuery, countryQuery] };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createCommitteeElection(
  partyId: string,
  countryId: CountryId,
  currentTurn: number,
  durationTurns = COMMITTEE_ELECTION_DURATION_TURNS,
  effectiveNow = new Date()
): Promise<ObjectId> {
  const db = await getDb();
  const now = new Date(effectiveNow);
  const window = createTurnBackedWindow({ currentTurn, durationTurns, effectiveNow: now });

  const election: Omit<NationalCommitteeElection, "_id"> = {
    partyId,
    countryId,
    status: "voting",
    startTime: window.startTime,
    endTime: window.endTime,
    startTurn: window.startTurn,
    endTurn: window.endTurn,
    durationTurns,
    winnerIds: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("nationalCommitteeElections").insertOne(election);

  console.log(
    `[NationalCommitteeElections] Created committee election for ${countryId}:${partyId} ` +
      `(turns ${currentTurn}–${currentTurn + durationTurns})`
  );

  await notifyCommitteeElectionOpened(partyId, countryId);

  return result.insertedId;
}

// ─── Create Missing ──────────────────────────────────────────────────────────

export async function createMissingCommitteeElections(
  currentTurn: number,
  durationTurns = COMMITTEE_ELECTION_DURATION_TURNS,
  effectiveNow = new Date(),
  countryId?: CountryId
): Promise<number> {
  const db = await getDb();
  const now = new Date(effectiveNow);
  const scopedPartiesQuery = applyOptionalCountryScope({}, countryId);
  const scopedActiveElectionQuery = applyOptionalCountryScope({ status: "voting" }, countryId);

  const [parties, activeElections] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find(scopedPartiesQuery).toArray(),
    db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .find(scopedActiveElectionQuery)
      .toArray(),
  ]);

  // Use countryId:partyId as the key to distinguish parties across countries
  const activeSet = new Set(activeElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}`));
  const toCreate: {
    partyId: string;
    countryId: CountryId;
    effectiveDurationTurns: number;
  }[] = [];
  for (const party of parties) {
    const countryId = party.countryId ?? "US";
    const key = `${countryId}:${String(party.sequentialId)}`;
    if (!activeSet.has(key)) {
      // Mirror national leadership: if a party has voted to extend terms via
      // CommitteeProposal(electionDuration), committee terms scale alongside.
      const effectiveDurationTurns = party.customElectionDurationTurns ?? durationTurns;
      toCreate.push({
        partyId: String(party.sequentialId),
        countryId,
        effectiveDurationTurns,
      });
    }
  }

  if (toCreate.length === 0) return 0;

  const elections: Omit<NationalCommitteeElection, "_id">[] = toCreate.map(
    ({ partyId, countryId, effectiveDurationTurns }) => {
      const window = createTurnBackedWindow({
        currentTurn,
        durationTurns: effectiveDurationTurns,
        effectiveNow: now,
      });
      return {
        partyId,
        countryId,
        status: "voting",
        startTime: window.startTime,
        endTime: window.endTime,
        startTurn: window.startTurn,
        endTurn: window.endTurn,
        durationTurns: effectiveDurationTurns,
        winnerIds: [],
        createdAt: now,
        updatedAt: now,
      };
    }
  );

  await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .insertMany(elections as NationalCommitteeElection[]);
  await Promise.all(
    toCreate.map(({ partyId, countryId }) => notifyCommitteeElectionOpened(partyId, countryId))
  );

  if (toCreate.length > 0) {
    console.log(`[NationalCommitteeElections] Created ${toCreate.length} missing elections`);
  }

  return toCreate.length;
}

// ─── Process Completed ───────────────────────────────────────────────────────

export async function processCompletedCommitteeElections(
  currentTurn: number,
  effectiveNow = new Date(),
  countryId?: CountryId
): Promise<number> {
  const db = await getDb();
  const now = new Date(effectiveNow);

  // Turn-based resolution only. The wall-clock endTime branch was removed: under
  // non-hourly turn cadence it resolved elections long before endTurn (see
  // turnBackedWindow.ts). All docs carry endTurn, so no Date fallback is needed.
  const scopedEndedElectionQuery = applyOptionalCountryScope(
    {
      status: "voting",
      endTurn: { $lte: currentTurn },
    },
    countryId
  );
  const endedElections = await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .find(scopedEndedElectionQuery)
    .toArray();

  if (endedElections.length === 0) return 0;

  const electionIds = endedElections.map((e) => e._id);

  // Build unique party keys (countryId:sequentialId)
  const partyKeys = [...new Set(endedElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}`))];

  // Fetch all parties that have elections ending
  const partyQueries = partyKeys.map((key) => {
    const [countryId, partyId] = key.split(":");
    const seqId = Number.parseInt(partyId, 10);
    return { countryId: countryId as CountryId, sequentialId: seqId };
  });

  // Resolve banned characters once so we can drop their candidacies and votes
  // from the tally — defensive against accounts banned before the ban-time
  // cleanup helper shipped (or banned via direct DB edits).
  const bannedCharacterIds = await getBannedCharacterIds(db);

  const [allCandidatesRaw, allVotesRaw, parties] = await Promise.all([
    db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    db
      .collection<NationalCommitteeVote>("nationalCommitteeVotes")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    partyQueries.length > 0
      ? db.collection<PoliticalParty>("politicalParties").find({ $or: partyQueries }).toArray()
      : Promise.resolve([] as PoliticalParty[]),
  ]);

  // Drop banned candidates outright and ignore vote rows cast by banned voters.
  const allCandidates = allCandidatesRaw.filter(
    (c) => !bannedCharacterIds.has(c.characterId.toString())
  );
  const allVotes = dedupeCommitteeVotes(
    allVotesRaw.filter((v) => !bannedCharacterIds.has(v.voterId.toString()))
  );

  const candidatesByElection = new Map<string, NationalCommitteeCandidate[]>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(c);
    candidatesByElection.set(key, list);
  }

  // Build active candidate set per election so we can ignore votes cast for
  // candidates who have since been removed (e.g. banned, withdrawn).
  const activeCandidateIdsByElection = new Map<string, Set<string>>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    let set = activeCandidateIdsByElection.get(key);
    if (!set) {
      set = new Set<string>();
      activeCandidateIdsByElection.set(key, set);
    }
    set.add(c.characterId.toString());
  }

  const voteCountByElectionAndCandidate = new Map<string, Map<string, number>>();
  for (const vote of allVotes) {
    const key = vote.electionId.toString();
    const activeSet = activeCandidateIdsByElection.get(key);
    let map = voteCountByElectionAndCandidate.get(key);
    if (!map) {
      map = new Map<string, number>();
      voteCountByElectionAndCandidate.set(key, map);
    }
    for (const candidateId of vote.candidateIds) {
      const cKey = candidateId.toString();
      if (activeSet && !activeSet.has(cKey)) continue;
      map.set(cKey, (map.get(cKey) ?? 0) + 1);
    }
  }

  // Map parties by countryId:sequentialId
  const partyMap = new Map(
    parties.map((p) => [`${p.countryId ?? "US"}:${String(p.sequentialId)}`, p])
  );

  const electionOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const partyOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const notifications: Promise<unknown>[] = [];

  for (const election of endedElections) {
    const { partyId, countryId } = election;
    const electionCountryId = countryId ?? "US";
    const electionKey = election._id.toString();
    const candidates = candidatesByElection.get(electionKey) ?? [];
    const voteCountMap =
      voteCountByElectionAndCandidate.get(electionKey) ?? new Map<string, number>();

    const sortedCandidates = candidates
      .map((c) => ({
        characterId: c.characterId,
        characterName: c.characterName,
        voteCount: voteCountMap.get(c.characterId.toString()) || 0,
        enteredAt: c.enteredAt,
      }))
      .sort((a, b) => {
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
        return a.enteredAt.getTime() - b.enteredAt.getTime();
      });

    const winners = sortedCandidates.slice(0, COMMITTEE_SIZE);
    const winnerIds = winners.map((w) => w.characterId);

    electionOps.push({
      updateOne: {
        filter: { _id: election._id },
        update: { $set: { status: "completed", winnerIds, updatedAt: now } },
      },
    });

    const partyKey = `${electionCountryId}:${partyId}`;
    const party = partyMap.get(partyKey);
    const previousCommitteeIds = party?.committeeIds || [];

    if (party) {
      partyOps.push({
        updateOne: {
          filter: { _id: party._id },
          update: { $set: { committeeIds: winnerIds, updatedAt: now } },
        },
      });
    }

    for (const winner of winners) {
      notifications.push(
        notifyCommitteeElected(
          winner.characterId,
          partyId,
          electionCountryId,
          winner.characterName,
          winner.voteCount
        )
      );
    }
    for (const prevId of previousCommitteeIds) {
      if (!winnerIds.some((w) => w.equals(prevId))) {
        notifications.push(notifyCommitteeRemoved(prevId, partyId, electionCountryId));
      }
    }
    const losers = sortedCandidates.slice(COMMITTEE_SIZE);
    for (const loser of losers) {
      notifications.push(
        notifyCommitteeLost(
          loser.characterId,
          partyId,
          electionCountryId,
          loser.characterName,
          loser.voteCount
        )
      );
    }
    console.log(
      `[NationalCommitteeElections] ${electionCountryId}:${partyId} committee: ` +
        `${winners.length} elected (${winners.map((w) => `${w.characterName}:${w.voteCount}`).join(", ")})`
    );
  }

  await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .bulkWrite(electionOps);

  // Terminalize the resolved elections' candidacies. The candidate docs are
  // read for the tally above (status:"active"), so this must run afterward.
  // Without it they linger as "active" and trip the per-party unique index,
  // blocking the character from declaring in the next cycle's committee election
  // ("already running… withdraw first") with no UI path to clear them.
  await db
    .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
    .updateMany(
      { electionId: { $in: electionIds }, status: "active" },
      { $set: { status: "completed", resolvedAt: now } }
    );

  await db.collection<PoliticalParty>("politicalParties").bulkWrite(partyOps);
  await Promise.all(notifications);

  if (endedElections.length > 0) {
    console.log(`[NationalCommitteeElections] Resolved ${endedElections.length} elections`);
  }

  return endedElections.length;
}

// ─── Main entry point (called from turn system) ──────────────────────────────

export async function processNationalCommitteeElections(
  currentTurn: number,
  effectiveNow = new Date()
): Promise<{
  electionsCreated: number;
  electionsCompleted: number;
}> {
  try {
    const electionsCompleted = await processCompletedCommitteeElections(currentTurn, effectiveNow);
    const electionsCreated = await createMissingCommitteeElections(
      currentTurn,
      COMMITTEE_ELECTION_DURATION_TURNS,
      effectiveNow
    );
    const db = await getDb();
    await expireOpenProposals(db, currentTurn);
    await expirePendingTransactions(db, currentTurn);
    // Defensive sweep: reconcile any coalition whose stored
    // chairCharacterId has drifted from the lead party's current
    // chairId (the per-mutation `syncCoalitionChairsForParty` helper
    // covers the common paths, but a chair change via a route that
    // forgets to call it would otherwise leave the coalition rendering
    // the stale chair until the next time the lead party's chair
    // election resolves).
    await reconcileAllCoalitionChairs(db, effectiveNow);
    return { electionsCreated, electionsCompleted };
  } catch (error) {
    console.error("[NationalCommitteeElections] Error:", error);
    return { electionsCreated: 0, electionsCompleted: 0 };
  }
}

// ─── Notification helpers ────────────────────────────────────────────────────

async function notifyCommitteeElectionOpened(partyId: string, countryId: CountryId): Promise<void> {
  const db = await getDb();
  // Filter members by both partyId and countryId to avoid cross-country notifications
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const committeeLabel = getPartyRoleLabel(countryId, "committee");

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "committee_election_opened",
      title: `${committeeLabel} Election Open`,
      message:
        `A new ${committeeLabel} election has opened for the ${partyName}. ` +
        `Voting is open for ${COMMITTEE_ELECTION_DURATION_TURNS} turns (1 week). ` +
        `You may vote for up to 6 candidates. Declare your candidacy or cast your votes on the party page.`,
      metadata: { partyId, countryId },
    }))
  );
}

async function notifyCommitteeElected(
  characterId: ObjectId,
  partyId: string,
  countryId: CountryId,
  characterName: string,
  voteCount: number
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const committeeLabel = getPartyRoleLabel(countryId, "committee");

  await createNotification({
    userId: char.userId,
    type: "committee_elected",
    title: `Elected to ${committeeLabel}!`,
    message:
      `Congratulations, ${characterName}! You have been elected to the ${partyName} ${committeeLabel} ` +
      `with ${voteCount} votes. You now serve on this governing body.`,
    metadata: { partyId, countryId, voteCount },
  });
}

async function notifyCommitteeLost(
  characterId: ObjectId,
  partyId: string,
  countryId: CountryId,
  characterName: string,
  voteCount: number
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const committeeLabel = getPartyRoleLabel(countryId, "committee");

  await createNotification({
    userId: char.userId,
    type: "committee_lost",
    title: `${committeeLabel} Election Result`,
    message:
      `The ${partyName} ${committeeLabel} election has concluded. ` +
      `With ${voteCount} votes, you did not place in the top 6. Better luck next time, ${characterName}.`,
    metadata: { partyId, countryId, voteCount },
  });
}

async function notifyCommitteeRemoved(
  characterId: ObjectId,
  partyId: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  const committeeLabel = getPartyRoleLabel(countryId, "committee");
  await createNotification({
    userId: char.userId,
    type: "committee_removed",
    title: `Removed from ${committeeLabel}`,
    message: `You have been replaced on the ${committeeLabel} following the conclusion of the election.`,
    metadata: { partyId, countryId },
  });
}

export async function notifyCommitteeCandidacyDeclared(
  partyId: string,
  countryId: CountryId,
  candidateName: string,
  candidateCharId: ObjectId
): Promise<void> {
  const db = await getDb();
  // Filter members by both partyId and countryId to avoid cross-country notifications
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId, _id: { $ne: candidateCharId } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const committeeLabel = getPartyRoleLabel(countryId, "committee");

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "committee_candidacy",
      title: `New ${committeeLabel} Candidate`,
      message:
        `${candidateName} has declared their candidacy for the ${partyName} ${committeeLabel}. ` +
        `Cast your votes on the party page.`,
      metadata: {
        partyId,
        countryId,
        candidateName,
        recipientCharacterId: m._id.toString(),
      },
    }))
  );
}
