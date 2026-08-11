import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createNotification, createNotifications } from "@/lib/notifications";
import { processCaucusChairElections } from "@/lib/caucusChairElections";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import type {
  NationalPartyElection,
  NationalPartyElectionPosition,
  NationalPartyVote,
  NationalPartyCandidate,
  PoliticalParty,
  Character,
  GameState,
  User,
} from "@/lib/db/types";
import { DEFAULT_LEGACY_COUNTRY_ID, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { createTurnBackedWindow } from "@/lib/time/turnBackedWindow";
import {
  resolveDefaultCycleEndTurn,
  type CycleAnchorCandidate,
} from "@/lib/elections/defaultCycleAnchor";
import { isUserActive } from "@/lib/players/playerActivity";
import { LEADERSHIP_INACTIVE_TURN_THRESHOLD } from "@/lib/statePartyElections";

export const NATIONAL_ELECTION_DURATION_TURNS = 72;
export const NATIONAL_ELECTION_MIN_DURATION_TURNS = 168;
export const NATIONAL_ELECTION_MAX_DURATION_TURNS = 420;
/**
 * Duration of the accelerated leadership elections each party runs while the
 * live pre-iteration founding phase is active. 12 turns ≈ 12 hours. Founding
 * elections are marked `founding: true` and waive the 24h new-character
 * cooldown and the party-tenure gate, so brand-new players can seat the full
 * leadership slate (chair / vice-chair / treasurer) at iteration start.
 */
export const FOUNDING_CHAIR_ELECTION_DURATION_TURNS = 12;
export const NATIONAL_ALL_POSITIONS: NationalPartyElectionPosition[] = [
  "chair",
  "viceChair",
  "treasurer",
];

const POSITION_FIELD: Record<
  NationalPartyElectionPosition,
  "chairId" | "viceChairId" | "treasurerId"
> = {
  chair: "chairId",
  viceChair: "viceChairId",
  treasurer: "treasurerId",
};

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

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createNationalElection(
  partyId: string,
  countryId: CountryId,
  position: NationalPartyElectionPosition,
  currentTurn: number,
  durationTurns = NATIONAL_ELECTION_DURATION_TURNS,
  effectiveNow = new Date()
): Promise<ObjectId> {
  const db = await getDb();
  const now = new Date(effectiveNow);
  const window = createTurnBackedWindow({ currentTurn, durationTurns, effectiveNow: now });

  const election: Omit<NationalPartyElection, "_id"> = {
    partyId,
    countryId,
    position,
    status: "voting",
    startTime: window.startTime,
    endTime: window.endTime,
    startTurn: window.startTurn,
    endTurn: window.endTurn,
    durationTurns,
    winnerId: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("nationalPartyElections").insertOne(election);

  console.log(
    `[NationalPartyElections] Created ${position} election for ${countryId}:${partyId} ` +
      `(turns ${currentTurn}–${currentTurn + durationTurns})`
  );

  await notifyNationalMembersElectionOpened(partyId, countryId, position, durationTurns);

  return result.insertedId;
}

// ─── Create Missing ──────────────────────────────────────────────────────────

export async function createMissingNationalElections(
  currentTurn: number,
  durationTurns = NATIONAL_ELECTION_DURATION_TURNS,
  effectiveNow = new Date(),
  countryId?: CountryId
): Promise<number> {
  const db = await getDb();
  const now = new Date(effectiveNow);

  // Founding branch: while the pre-iteration founding phase is active, parties
  // run accelerated 12-turn elections for every vacant leadership seat (chair,
  // vice-chair, treasurer), waiving the 24h new-character cooldown and the
  // tenure gate so brand-new players can seat a full slate at iteration start.
  if (await isFoundingPhaseActive(db)) {
    return createMissingFoundingLeadershipElections(db, currentTurn, now, countryId);
  }

  const scopedPartiesQuery = applyOptionalCountryScope({}, countryId);
  const scopedActiveElectionQuery = applyOptionalCountryScope({ status: "voting" }, countryId);
  // Positions whose most recent election was quorum-accelerated and resolved
  // early still owe the remainder of their natural cycle. Until the original
  // (pre-acceleration) end turn arrives, do NOT recreate them — otherwise the
  // accelerated position (only ever the chair) restarts off-cycle and drifts
  // permanently ahead of the others. At originalEndTurn it recreates alongside
  // viceChair/treasurer, which resolve on that same shared turn.
  const scopedDeferredElectionQuery = applyOptionalCountryScope(
    {
      status: "completed",
      quorumAcceleratedAtTurn: { $exists: true },
      originalEndTurn: { $gt: currentTurn },
    },
    countryId
  );

  const [parties, activeElections, deferredElections] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find(scopedPartiesQuery).toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find(scopedActiveElectionQuery)
      .toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find(scopedDeferredElectionQuery)
      .toArray(),
  ]);

  // Use countryId:partyId:position as the key to distinguish parties across countries
  const activeSet = new Set(
    activeElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}_${e.position}`)
  );
  // Positions covered by an in-window deferral — treated as already "present"
  // so they are skipped by the create loop below.
  const deferredSet = new Set(
    deferredElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}_${e.position}`)
  );

  // Anchor candidates for the shared default cycle: active elections plus
  // in-window accelerated deferrals (their originalEndTurn is the natural
  // cycle end). Computed once per run, memoized per country, so a party
  // appearing mid-cycle (freshly chartered, or with a lost election) joins
  // the cadence every other default-duration party is on instead of
  // starting its own drifting `currentTurn + duration` cycle.
  const anchorCandidates: CycleAnchorCandidate[] = [...activeElections, ...deferredElections].map(
    (e) => ({
      countryId: e.countryId ?? "US",
      durationTurns: e.durationTurns,
      endTurn: e.endTurn,
      originalEndTurn: e.originalEndTurn,
    })
  );
  const anchorByCountry = new Map<string, number>();
  const cycleDurationFor = (partyCountryId: string): number => {
    let anchor = anchorByCountry.get(partyCountryId);
    if (anchor === undefined) {
      anchor = resolveDefaultCycleEndTurn(anchorCandidates, {
        defaultDurationTurns: durationTurns,
        currentTurn,
        countryId: partyCountryId,
      });
      anchorByCountry.set(partyCountryId, anchor);
    }
    return anchor - currentTurn;
  };

  const toCreate: {
    partyId: string;
    countryId: CountryId;
    position: NationalPartyElectionPosition;
    effectiveDurationTurns: number;
  }[] = [];
  for (const party of parties) {
    const partyCountryId = party.countryId ?? "US";
    const effectiveDurationTurns =
      party.customElectionDurationTurns ?? cycleDurationFor(partyCountryId);
    for (const position of NATIONAL_ALL_POSITIONS) {
      const key = `${partyCountryId}:${String(party.sequentialId)}_${position}`;
      if (!activeSet.has(key) && !deferredSet.has(key)) {
        toCreate.push({
          partyId: String(party.sequentialId),
          countryId: partyCountryId,
          position,
          effectiveDurationTurns,
        });
      }
    }
  }

  if (toCreate.length === 0) return 0;

  const elections: Omit<NationalPartyElection, "_id">[] = toCreate.map(
    ({ partyId, countryId, position, effectiveDurationTurns }) => {
      const window = createTurnBackedWindow({
        currentTurn,
        durationTurns: effectiveDurationTurns,
        effectiveNow: now,
      });
      return {
        partyId,
        countryId,
        position,
        status: "voting",
        startTime: window.startTime,
        endTime: window.endTime,
        startTurn: window.startTurn,
        endTurn: window.endTurn,
        durationTurns: effectiveDurationTurns,
        winnerId: null,
        createdAt: now,
        updatedAt: now,
      };
    }
  );

  await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .insertMany(elections as NationalPartyElection[]);
  // Group positions by party so members get one consolidated notification.
  // All of a party's positions share the same window, so the entry carries
  // the effective duration for the message.
  const byParty = new Map<
    string,
    {
      partyId: string;
      countryId: CountryId;
      positions: NationalPartyElectionPosition[];
      durationTurns: number;
    }
  >();
  for (const { partyId, countryId, position, effectiveDurationTurns } of toCreate) {
    const key = `${countryId}:${partyId}`;
    const entry = byParty.get(key);
    if (entry) {
      entry.positions.push(position);
    } else {
      byParty.set(key, {
        partyId,
        countryId,
        positions: [position],
        durationTurns: effectiveDurationTurns,
      });
    }
  }
  await Promise.all(
    Array.from(byParty.values()).map(({ partyId, countryId, positions, durationTurns }) =>
      notifyNationalMembersElectionsOpenedBatch(partyId, countryId, positions, durationTurns)
    )
  );

  if (toCreate.length > 0) {
    console.log(`[NationalPartyElections] Created ${toCreate.length} missing elections`);
  }

  return toCreate.length;
}

async function isFoundingPhaseActive(db: Db): Promise<boolean> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preIteration: 1 } });
  return gameState?.preIteration?.active === true;
}

/**
 * Founding-phase variant of the create-missing sweep. Spawns an accelerated
 * 12-turn election — marked `founding: true` so the enter/vote routes waive
 * the 24h new-character cooldown and the party-tenure gate — for every vacant
 * leadership seat (chair / vice-chair / treasurer). A party whose race
 * produced no winner (no candidates) gets another shot on the next sweep.
 */
async function createMissingFoundingLeadershipElections(
  db: Db,
  currentTurn: number,
  now: Date,
  countryId?: CountryId
): Promise<number> {
  const scopedPartiesQuery = applyOptionalCountryScope({}, countryId);
  const scopedActiveElectionQuery = applyOptionalCountryScope({ status: "voting" }, countryId);

  const [parties, activeElections] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find(scopedPartiesQuery).toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find(scopedActiveElectionQuery)
      .toArray(),
  ]);

  const activeSet = new Set(
    activeElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}:${e.position}`)
  );

  const toCreate: {
    party: PoliticalParty;
    position: NationalPartyElectionPosition;
  }[] = [];
  for (const party of parties) {
    const partyKey = `${party.countryId ?? "US"}:${String(party.sequentialId)}`;
    for (const position of NATIONAL_ALL_POSITIONS) {
      const field = POSITION_FIELD[position];
      const seated = party[field] != null;
      if (seated) continue;
      if (activeSet.has(`${partyKey}:${position}`)) continue;
      toCreate.push({ party, position });
    }
  }
  if (toCreate.length === 0) return 0;

  const window = createTurnBackedWindow({
    currentTurn,
    durationTurns: FOUNDING_CHAIR_ELECTION_DURATION_TURNS,
    effectiveNow: now,
  });

  const elections: Omit<NationalPartyElection, "_id">[] = toCreate.map(({ party, position }) => ({
    partyId: String(party.sequentialId),
    countryId: party.countryId ?? "US",
    position,
    status: "voting",
    startTime: window.startTime,
    endTime: window.endTime,
    startTurn: window.startTurn,
    endTurn: window.endTurn,
    durationTurns: FOUNDING_CHAIR_ELECTION_DURATION_TURNS,
    founding: true,
    winnerId: null,
    createdAt: now,
    updatedAt: now,
  }));

  await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .insertMany(elections as NationalPartyElection[]);

  // One notification per party listing every position that just opened.
  const byParty = new Map<
    string,
    { partyId: string; countryId: CountryId; positions: NationalPartyElectionPosition[] }
  >();
  for (const { party, position } of toCreate) {
    const partyId = String(party.sequentialId);
    const country = (party.countryId ?? "US") as CountryId;
    const key = `${country}:${partyId}`;
    const entry = byParty.get(key);
    if (entry) entry.positions.push(position);
    else byParty.set(key, { partyId, countryId: country, positions: [position] });
  }
  await Promise.all(
    Array.from(byParty.values()).map(({ partyId, countryId: cid, positions }) =>
      notifyNationalMembersElectionsOpenedBatch(
        partyId,
        cid,
        positions,
        FOUNDING_CHAIR_ELECTION_DURATION_TURNS,
        { founding: true }
      )
    )
  );

  console.log(
    `[NationalPartyElections] Created ${toCreate.length} founding leadership election(s)`
  );
  return toCreate.length;
}

// ─── Process Completed ───────────────────────────────────────────────────────

export async function processCompletedNationalElections(
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
    .collection<NationalPartyElection>("nationalPartyElections")
    .find(scopedEndedElectionQuery)
    .toArray();

  if (endedElections.length === 0) return 0;

  const electionIds = endedElections.map((e) => e._id);
  const partyIds = [...new Set(endedElections.map((e) => e.partyId))];
  const countryIds = [...new Set(endedElections.map((e) => e.countryId ?? "US"))];

  const sequentialPartyIds = partyIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));

  // Resolve banned characters once so we can drop their candidacies and votes
  // from the tally — defensive against accounts banned before the ban-time
  // cleanup helper shipped (or banned via direct DB edits).
  const bannedCharacterIds = await getBannedCharacterIds(db);
  const bannedVoterObjectIds = [...bannedCharacterIds].map((id) => new ObjectId(id));

  const voteMatch: Record<string, unknown> = { electionId: { $in: electionIds } };
  if (bannedVoterObjectIds.length > 0) {
    voteMatch.voterId = { $nin: bannedVoterObjectIds };
  }

  const [allCandidatesRaw, voteCountsByElection, parties] = await Promise.all([
    db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    db
      .collection<NationalPartyVote>("nationalPartyVotes")
      .aggregate<{
        electionId: ObjectId;
        candidateId: ObjectId;
        count: number;
        partyInfluenceSum: number;
      }>([
        { $match: voteMatch },
        { $sort: { votedAt: -1, _id: -1 } },
        {
          $group: {
            _id: { electionId: "$electionId", voterId: "$voterId" },
            candidateId: { $first: "$candidateId" },
            voterPartyInfluence: { $first: "$voterPartyInfluence" },
          },
        },
        {
          $group: {
            _id: { electionId: "$_id.electionId", candidateId: "$candidateId" },
            count: { $sum: 1 },
            partyInfluenceSum: { $sum: { $ifNull: ["$voterPartyInfluence", 0] } },
          },
        },
        {
          $project: {
            electionId: "$_id.electionId",
            candidateId: "$_id.candidateId",
            count: 1,
            partyInfluenceSum: 1,
            _id: 0,
          },
        },
      ])
      .toArray(),
    sequentialPartyIds.length > 0
      ? db
          .collection<PoliticalParty>("politicalParties")
          .find({ sequentialId: { $in: sequentialPartyIds }, countryId: { $in: countryIds } })
          .toArray()
      : Promise.resolve([] as PoliticalParty[]),
  ]);

  const allCandidates = allCandidatesRaw.filter(
    (c) => !bannedCharacterIds.has(c.characterId.toString())
  );

  const candidatesByElection = new Map<string, NationalPartyCandidate[]>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(c);
    candidatesByElection.set(key, list);
  }

  // Build per-election sets of active candidate IDs to filter out stale votes.
  // Without this, a withdrawn candidate could "win" if their stored vote count
  // exceeds active candidates' (winnerCand lookup would fail and winnerName = "Unknown").
  const activeCharIdsByElection = new Map<string, Set<string>>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    let set = activeCharIdsByElection.get(key);
    if (!set) {
      set = new Set<string>();
      activeCharIdsByElection.set(key, set);
    }
    set.add(c.characterId.toString());
  }

  const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));

  // Build a map of electionId → whether to use partyInfluence-weighted scoring
  const useInfluenceByElection = new Map<string, boolean>();
  for (const election of endedElections) {
    const party = partyMap.get(`${election.countryId ?? "US"}:${election.partyId}`);
    useInfluenceByElection.set(
      election._id.toString(),
      party?.leadershipElectionMethod === "influence"
    );
  }

  const voteCountsByElectionMap = new Map<string, { candidateId: ObjectId; count: number }[]>();
  for (const v of voteCountsByElection) {
    const key = v.electionId.toString();
    if (!activeCharIdsByElection.get(key)?.has(v.candidateId.toString())) continue;
    const score = useInfluenceByElection.get(key) ? v.partyInfluenceSum : v.count;
    const list = voteCountsByElectionMap.get(key) ?? [];
    list.push({ candidateId: v.candidateId, count: score });
    voteCountsByElectionMap.set(key, list);
  }
  for (const list of voteCountsByElectionMap.values()) {
    list.sort((a, b) => b.count - a.count);
  }

  const electionOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const partyOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const notifications: Promise<unknown>[] = [];
  // Track party chair changes for coalition sync (newChairId may be null when
  // the chair vacates by winning a different office and no one replaces them)
  const chairChanges: { partyOid: ObjectId; newChairId: ObjectId | null }[] = [];

  // First pass: compute winners and queue election-status updates.
  // Party updates are deferred so we can consolidate multiple position changes
  // per party and auto-vacate any other office the winner currently holds.
  type WinningResult = {
    election: NationalPartyElection;
    winnerId: ObjectId;
    winnerName: string;
    candidates: NationalPartyCandidate[];
    topVoteCount: number;
  };
  const winningResults: WinningResult[] = [];

  for (const election of endedElections) {
    const { partyId, position } = election;
    const key = election._id.toString();
    const candidates = candidatesByElection.get(key) ?? [];
    const voteCounts = voteCountsByElectionMap.get(key) ?? [];

    let winnerId: ObjectId | null = null;
    let winnerName: string | null = null;

    if (candidates.length > 0 && voteCounts.length > 0) {
      const topCount = voteCounts[0].count;
      const tied = voteCounts.filter((v) => v.count === topCount);

      if (tied.length === 1) {
        winnerId = tied[0].candidateId;
      } else {
        const tiedCands = candidates
          .filter((c) => tied.some((t) => t.candidateId.equals(c.characterId)))
          .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
        if (tiedCands.length > 0) winnerId = tiedCands[0].characterId;
      }

      const resolvedWinnerId = winnerId; // capture for closure narrowing
      const winnerCand = candidates.find((c) => c.characterId.equals(resolvedWinnerId!));
      winnerName = winnerCand?.characterName ?? "Unknown";
    }

    electionOps.push({
      updateOne: {
        filter: { _id: election._id },
        update: { $set: { status: "completed", winnerId, updatedAt: now } },
      },
    });

    if (winnerId && winnerName) {
      winningResults.push({
        election,
        winnerId,
        winnerName,
        candidates,
        topVoteCount: voteCounts[0]?.count ?? 0,
      });
    } else {
      console.log(
        `[NationalPartyElections] ${partyId} ${position}: no candidates — position unchanged`
      );
    }
  }

  // Group winning results by party so multiple position changes for the same
  // party collapse into a single update — required for the cross-position
  // auto-vacate to interact correctly with same-batch winner assignments.
  const resultsByParty = new Map<string, WinningResult[]>();
  for (const r of winningResults) {
    const partyKey = `${r.election.countryId ?? "US"}:${r.election.partyId}`;
    const list = resultsByParty.get(partyKey) ?? [];
    list.push(r);
    resultsByParty.set(partyKey, list);
  }

  for (const [partyKey, results] of resultsByParty) {
    const party = partyMap.get(partyKey);
    if (!party) {
      // Without a matching party doc we can't write updates; log and move on.
      for (const r of results) {
        console.log(
          `[NationalPartyElections] ${r.election.partyId} ${r.election.position}: party not found, skipping update`
        );
      }
      continue;
    }

    const setUpdates: Record<string, unknown> = { updatedAt: now };
    const assignedFields = new Set<"chairId" | "viceChairId" | "treasurerId">();
    for (const r of results) {
      const field = POSITION_FIELD[r.election.position];
      setUpdates[field] = r.winnerId;
      assignedFields.add(field);
      if (r.election.position === "chair") {
        chairChanges.push({ partyOid: party._id as ObjectId, newChairId: r.winnerId });
      }
    }

    // Auto-vacate: if a winner currently holds another office in this party
    // (e.g. they were chair and just won vice chair), clear the prior office.
    // Skip fields being assigned by another election in the same batch — that
    // election's winner takes precedence over the vacate.
    for (const r of results) {
      for (const otherPos of NATIONAL_ALL_POSITIONS) {
        if (otherPos === r.election.position) continue;
        const otherField = POSITION_FIELD[otherPos];
        if (assignedFields.has(otherField)) continue;
        const currentHolder = party[otherField];
        if (currentHolder && (currentHolder as ObjectId).equals(r.winnerId)) {
          setUpdates[otherField] = null;
          notifications.push(
            notifyNationalLeadershipVacatedForNewRole(
              r.winnerId,
              r.election.partyId,
              otherPos,
              r.election.position,
              r.election.countryId
            )
          );
          if (otherPos === "chair") {
            chairChanges.push({ partyOid: party._id as ObjectId, newChairId: null });
          }
        }
      }
    }

    partyOps.push({
      updateOne: { filter: { _id: party._id }, update: { $set: setUpdates } },
    });

    for (const r of results) {
      const { election, winnerId, winnerName, candidates, topVoteCount } = r;
      const { partyId, position } = election;
      const field = POSITION_FIELD[position];
      const previousHolderId = party[field] ?? null;

      notifications.push(
        notifyNationalLeadershipElected(winnerId, partyId, position, winnerName, election.countryId)
      );
      notifications.push(
        import("@/lib/achievements")
          .then(async ({ awardAchievement, resolveUserIdFromCharacter }) => {
            const winnerUserId = await resolveUserIdFromCharacter(winnerId);
            if (winnerUserId) await awardAchievement(winnerUserId, "party_leader", winnerId);
          })
          .catch((e) => console.error("Achievement check failed:", e))
      );
      if (previousHolderId && !(previousHolderId as ObjectId).equals(winnerId)) {
        notifications.push(
          notifyNationalLeadershipRemoved(
            previousHolderId as ObjectId,
            partyId,
            position,
            election.countryId
          )
        );
      }
      for (const cand of candidates) {
        if (!cand.characterId.equals(winnerId)) {
          notifications.push(
            notifyNationalLeadershipLost(
              cand.characterId,
              partyId,
              position,
              cand.characterName,
              winnerName,
              election.countryId
            )
          );
        }
      }
      console.log(
        `[NationalPartyElections] ${partyId} ${position}: ${winnerName} elected (${topVoteCount} votes)`
      );
    }
  }

  await db.collection<NationalPartyElection>("nationalPartyElections").bulkWrite(electionOps);

  // Terminalize the resolved elections' candidacies. The candidate docs are
  // read for the tally above (status:"active"), so this must run afterward.
  // Without it they linger as "active" and trip the per-party unique index,
  // blocking the character from declaring in the next cycle's election
  // ("already running… withdraw first") with no UI path to clear them.
  await db
    .collection<NationalPartyCandidate>("nationalPartyCandidates")
    .updateMany(
      { electionId: { $in: electionIds }, status: "active" },
      { $set: { status: "completed", resolvedAt: now } }
    );

  if (partyOps.length > 0) {
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(partyOps);
  }

  // Sync coalition chairCharacterId when the leading party's chair changes.
  // If both an "elected" and a "vacated" change exist for the same party
  // (e.g. someone won chair while the previous chair simultaneously vacated by
  // winning VC — impossible today since one person can't be in both batches,
  // but defensive nonetheless), the elected value wins because it's appended
  // first inside the resultsByParty loop above.
  if (chairChanges.length > 0) {
    const finalChair = new Map<string, ObjectId | null>();
    for (const { partyOid, newChairId } of chairChanges) {
      const key = partyOid.toString();
      if (!finalChair.has(key)) finalChair.set(key, newChairId);
    }
    const coalitionOps = Array.from(finalChair.entries()).map(([key, newChairId]) => ({
      updateMany: {
        filter: { chairPartyId: new ObjectId(key) },
        update: { $set: { chairCharacterId: newChairId, updatedAt: now } },
      },
    }));
    await db.collection("coalitions").bulkWrite(coalitionOps);
  }

  await Promise.all(notifications);

  if (endedElections.length > 0) {
    console.log(`[NationalPartyElections] Resolved ${endedElections.length} elections`);
  }

  return endedElections.length;
}

// ─── Quorum Acceleration ─────────────────────────────────────────────────────

/**
 * Quorum acceleration: when >50% of a party's eligible voters have cast a vote
 * AND the chair seat is vacant, halve the remaining election timer. Eligible
 * voters are player members (NPPs do not vote in leadership elections), or the
 * committee + leadership for committee-method parties — NOT the stored
 * `memberCount`, which also counts NPPs and drifts. This only applies to
 * chair-position elections. Fires at most once per election (tracked by
 * `quorumAcceleratedAtTurn`). Skipped on a party's first chair cycle (no prior
 * completed chair election) so inaugural / post-reset leadership races stay in
 * lockstep with viceChair/treasurer (ticket #1023).
 *
 * Returns the number of elections that were accelerated this turn.
 */
export async function applyQuorumAcceleration(
  currentTurn: number,
  countryId?: CountryId
): Promise<number> {
  const db = await getDb();

  // Find active chair elections that haven't been accelerated yet
  const scopedQuery = applyOptionalCountryScope(
    {
      status: "voting",
      position: "chair",
      quorumAcceleratedAtTurn: { $exists: false },
      // Only consider elections that haven't already ended
      endTurn: { $gt: currentTurn },
    },
    countryId
  );

  const candidateElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find(scopedQuery)
    .toArray();

  if (candidateElections.length === 0) return 0;

  // Collect unique party keys to fetch party data
  const partyKeys = [
    ...new Set(candidateElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}`)),
  ];
  const partySequentialIds = partyKeys.map((k) => Number.parseInt(k.split(":")[1], 10));
  const partyCountryIds = partyKeys.map((k) => k.split(":")[0] as CountryId);
  const partyIdStrings = partyKeys.map((k) => k.split(":")[1]);

  // First-cycle gate: only accelerate parties that have already finished at
  // least one chair election. Without this, post-reset / inaugural races
  // (often short, vacant-chair, high early turnout) desync chair timers from
  // viceChair/treasurer on day one.
  const priorCompletedQuery = applyOptionalCountryScope(
    {
      status: "completed",
      position: "chair",
      partyId: { $in: partyIdStrings },
    },
    countryId
  );
  const [parties, priorCompletedChairs] = await Promise.all([
    db
      .collection<PoliticalParty>("politicalParties")
      .find({
        sequentialId: { $in: partySequentialIds },
        countryId: { $in: partyCountryIds },
      })
      .toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find(priorCompletedQuery)
      .toArray(),
  ]);

  const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));
  const partiesWithPriorChairCycle = new Set(
    priorCompletedChairs.map((e) => `${e.countryId ?? "US"}:${e.partyId}`)
  );

  // Eligible-voter denominator per party. NPPs do not vote in leadership
  // elections, so quorum is measured against eligible PLAYER members — not the
  // stored `memberCount`, which also counts NPPs (and drifts). Committee-method
  // parties restrict voting to the committee + national leadership (handled in
  // the loop via getEligibleVoterSet); every other method ("party",
  // "influence") lets each player member vote, so we count them live here.
  const playerPartyIdStrings = parties.map((p) => String(p.sequentialId));
  const playerCountRaw = await db
    .collection("characters")
    .aggregate<{ _id: { party: string; countryId: string }; count: number }>([
      {
        $match: { party: { $in: playerPartyIdStrings }, countryId: { $in: partyCountryIds } },
      },
      { $group: { _id: { party: "$party", countryId: "$countryId" }, count: { $sum: 1 } } },
    ])
    .toArray();
  const playerCountByParty = new Map(
    playerCountRaw.map((r) => [`${r._id.countryId ?? "US"}:${r._id.party}`, r.count])
  );

  // Count distinct voters per chair election
  const electionIds = candidateElections.map((e) => e._id);
  const voteCountsRaw = await db
    .collection<NationalPartyVote>("nationalPartyVotes")
    .aggregate<{
      electionId: ObjectId;
      distinctVoters: number;
    }>([
      { $match: { electionId: { $in: electionIds } } },
      { $group: { _id: "$voterId", electionId: { $first: "$electionId" } } },
      {
        $group: {
          _id: "$electionId",
          distinctVoters: { $sum: 1 },
        },
      },
      {
        $project: {
          electionId: "$_id",
          distinctVoters: 1,
          _id: 0,
        },
      },
    ])
    .toArray();

  const votersByElection = new Map<string, number>();
  for (const v of voteCountsRaw) {
    votersByElection.set(v.electionId.toString(), v.distinctVoters);
  }

  // Determine which elections qualify for acceleration
  const acceleratedIds: ObjectId[] = [];
  const acceleratedUpdates: {
    electionId: ObjectId;
    newEndTurn: number;
    originalEndTurn: number;
  }[] = [];

  for (const election of candidateElections) {
    const partyKey = `${election.countryId ?? "US"}:${election.partyId}`;
    const party = partyMap.get(partyKey);
    if (!party) continue;

    // Skip inaugural chair races — keep the first cycle aligned with the other
    // national offices (ticket #1023).
    if (!partiesWithPriorChairCycle.has(partyKey)) continue;

    // Only accelerate when the chair seat is vacant
    if (party.chairId !== null) continue;

    // Eligible voters who may actually cast a ballot (NPPs cannot). Committee-
    // method elections restrict the electorate to committee + leadership; all
    // other methods enfranchise every player member.
    const eligibleVoterCount =
      party.leadershipElectionMethod === "committee"
        ? getEligibleVoterSet(party).size
        : (playerCountByParty.get(partyKey) ?? 0);
    if (eligibleVoterCount <= 0) continue;

    const voterCount = votersByElection.get(election._id.toString()) ?? 0;
    // >50% quorum threshold
    if (voterCount <= Math.floor(eligibleVoterCount / 2)) continue;

    // Halve the remaining timer: new endTurn = currentTurn + ceil((endTurn - currentTurn) / 2)
    const remaining = election.endTurn - currentTurn;
    const halvedRemaining = Math.ceil(remaining / 2);
    const newEndTurn = currentTurn + halvedRemaining;

    acceleratedIds.push(election._id);
    acceleratedUpdates.push({
      electionId: election._id,
      newEndTurn,
      originalEndTurn: election.endTurn,
    });
  }

  if (acceleratedIds.length === 0) return 0;

  // Apply acceleration updates
  const bulkOps = acceleratedUpdates.map(({ electionId, newEndTurn, originalEndTurn }) => ({
    updateOne: {
      filter: { _id: electionId },
      update: {
        $set: {
          endTurn: newEndTurn,
          // Preserve the pre-acceleration end turn so the NEXT election for this
          // position is deferred until the cycle would naturally have ended —
          // keeping chair in lockstep with viceChair/treasurer instead of
          // drifting ahead. Consumed by createMissingNationalElections.
          originalEndTurn,
          // Recalculate wall-clock endTime for display (1 turn ≈ 1h)
          endTime: new Date(Date.now() + (newEndTurn - currentTurn) * 60 * 60 * 1000),
          quorumAcceleratedAtTurn: currentTurn,
          updatedAt: new Date(),
        },
      },
    },
  }));

  await db.collection<NationalPartyElection>("nationalPartyElections").bulkWrite(bulkOps);

  console.log(
    `[NationalPartyElections] Quorum acceleration applied to ${acceleratedIds.length} chair election(s) ` +
      `(>50% members voted, chair seat vacant, timer halved)`
  );

  return acceleratedIds.length;
}

// ─── Main entry point (called from turn system) ──────────────────────────────

/**
 * Evict inactive NATIONAL party leadership (chair / vice-chair / treasurer),
 * mirroring {@link vacateInactiveLeadership} for state-party orgs (#3308,
 * follow-up to #972 / PR #3303). Holders whose user fails {@link isUserActive}
 * at the lenient {@link LEADERSHIP_INACTIVE_TURN_THRESHOLD} have their seat
 * `$set` to null so the next cycle opens against an empty seat; an abandoned
 * national chair otherwise blocks quorum acceleration, which requires a vacant
 * chair to fire.
 *
 * National-specific concern the state path lacks: when a CHAIR is vacated we
 * must also null the led coalition's `chairCharacterId`, mirroring the
 * elected/vacated chairChanges sync in {@link processCompletedNationalElections}
 * — otherwise coalition leadership desyncs from the (now empty) party chair.
 *
 * Batched: one `politicalParties` scan, one `characters` find, one `users` find.
 * Fully inert when everyone is active. Missing character/user/activity data is
 * treated as active (skip-on-missing) so data gaps never punish a holder.
 *
 * @returns the number of seats vacated.
 */
export async function vacateInactiveNationalLeadership(
  db: Db,
  currentTurn: number,
  effectiveNow: Date = new Date()
): Promise<number> {
  const now = new Date(effectiveNow);

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({
      $or: [
        { chairId: { $ne: null } },
        { viceChairId: { $ne: null } },
        { treasurerId: { $ne: null } },
      ],
    })
    .toArray();
  if (parties.length === 0) return 0;

  // Collect every distinct holder id, then batch-resolve characters → users.
  const holderIdByHex = new Map<string, ObjectId>();
  for (const party of parties) {
    for (const position of NATIONAL_ALL_POSITIONS) {
      const holder = party[POSITION_FIELD[position]];
      if (holder) holderIdByHex.set(holder.toString(), holder);
    }
  }
  const holderIds = Array.from(holderIdByHex.values());
  if (holderIds.length === 0) return 0;

  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: holderIds } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();
  const userIdByCharHex = new Map<string, ObjectId>();
  for (const c of characters) {
    if (c.userId) userIdByCharHex.set(c._id.toString(), c.userId);
  }

  const userIds = Array.from(
    new Map(Array.from(userIdByCharHex.values()).map((id) => [id.toString(), id])).values()
  );
  const users =
    userIds.length > 0
      ? await db
          .collection<User>("users")
          .find({ _id: { $in: userIds } })
          .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
            _id: 1,
            lastActivity: 1,
            createdAt: 1,
          })
          .toArray()
      : [];
  const userByHex = new Map(users.map((u) => [u._id.toString(), u]));

  // Inactive only when char → user resolves AND the user fails the lenient
  // activity check. Missing data → treat as active (never punish gaps).
  const isHolderInactive = (holder: ObjectId): boolean => {
    const userId = userIdByCharHex.get(holder.toString());
    if (!userId) return false;
    const user = userByHex.get(userId.toString());
    if (!user) return false;
    return !isUserActive(
      user.lastActivity,
      user.createdAt,
      now,
      LEADERSHIP_INACTIVE_TURN_THRESHOLD
    );
  };

  const partyOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  // Parties whose CHAIR was vacated — their led coalitions need a chair sync.
  const vacatedChairPartyOids: ObjectId[] = [];
  const notifications: Promise<unknown>[] = [];
  let vacated = 0;

  for (const party of parties) {
    const setUpdates: Record<string, unknown> = {};
    for (const position of NATIONAL_ALL_POSITIONS) {
      const field = POSITION_FIELD[position];
      const holder = party[field];
      if (!holder || !isHolderInactive(holder)) continue;
      setUpdates[field] = null;
      vacated += 1;
      if (position === "chair") vacatedChairPartyOids.push(party._id);
      notifications.push(
        notifyNationalLeadershipVacatedInactive(
          holder,
          String(party.sequentialId),
          position,
          party.countryId
        )
      );
      console.log(
        `[NationalPartyElections] Vacated inactive ${position} for party ${party.sequentialId} ` +
          `(${party.countryId}, holder ${holder.toString()}, turn ${currentTurn})`
      );
    }
    if (Object.keys(setUpdates).length > 0) {
      setUpdates.updatedAt = now;
      partyOps.push({ updateOne: { filter: { _id: party._id }, update: { $set: setUpdates } } });
    }
  }

  if (partyOps.length > 0) {
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(partyOps);
    // Coalition chair follows the party chair (same as the chairChanges sync):
    // when the party chair is vacated for inactivity, null the led coalition's
    // chairCharacterId so it doesn't dangle on a departed leader.
    if (vacatedChairPartyOids.length > 0) {
      await db
        .collection("coalitions")
        .updateMany(
          { chairPartyId: { $in: vacatedChairPartyOids } },
          { $set: { chairCharacterId: null, updatedAt: now } }
        );
    }
    await Promise.all(notifications);
    console.log(`[NationalPartyElections] Vacated ${vacated} inactive national leadership seat(s)`);
  }

  return vacated;
}

export async function processNationalPartyElections(
  currentTurn: number,
  effectiveNow = new Date()
): Promise<{
  electionsCreated: number;
  electionsCompleted: number;
}> {
  try {
    const electionsCompleted = await processCompletedNationalElections(currentTurn, effectiveNow);
    // Vacate abandoned national leadership BEFORE opening new elections, so the
    // next cycle runs against an empty seat (mirrors the state-party cycle).
    await vacateInactiveNationalLeadership(await getDb(), currentTurn, effectiveNow);
    const electionsCreated = await createMissingNationalElections(
      currentTurn,
      NATIONAL_ELECTION_DURATION_TURNS,
      effectiveNow
    );
    await processCaucusChairElections(currentTurn);
    await applyQuorumAcceleration(currentTurn);
    return { electionsCreated, electionsCompleted };
  } catch (error) {
    console.error("[NationalPartyElections] Error:", error);
    return { electionsCreated: 0, electionsCompleted: 0 };
  }
}

// ─── Notification helpers ────────────────────────────────────────────────────

async function notifyNationalMembersElectionOpened(
  partyId: string,
  countryId: CountryId,
  position: NationalPartyElectionPosition,
  durationTurns: number
): Promise<void> {
  const db = await getDb();
  // Filter members by both partyId and countryId to avoid cross-country notifications
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = getPartyRoleLabel(countryId, position);
  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_election_opened",
      title: `${label} Election Open`,
      message:
        `A new ${label} election has opened for the ${partyName}. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the party page.`,
      metadata: { partyId, countryId, position, recipientCharacterId: m._id.toString() },
    }))
  );
}

async function notifyNationalMembersElectionsOpenedBatch(
  partyId: string,
  countryId: CountryId,
  positions: NationalPartyElectionPosition[],
  durationTurns: number,
  opts: { founding?: boolean } = {}
): Promise<void> {
  const db = await getDb();
  const members = await db
    .collection<Character>("characters")
    .find({ party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  const labels = positions.map((p) => getPartyRoleLabel(countryId, p));
  const positionList =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const title =
    positions.length === 1 ? `${labels[0]} Election Open` : "National Leadership Elections Open";

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_election_opened",
      title,
      message:
        `New ${positionList} elections have opened for the ${partyName}. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the party page.` +
        (opts.founding
          ? ` This is an accelerated founding election — the 24-hour new-character and party-tenure requirements are waived, so every member can declare and vote immediately.`
          : ""),
      metadata: { partyId, countryId, positions, recipientCharacterId: m._id.toString() },
    }))
  );
}

async function notifyNationalLeadershipElected(
  winnerId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  winnerName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: winnerId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const label = getPartyRoleLabel(countryId, position);

  await createNotification({
    userId: char.userId,
    type: "national_leadership_elected",
    title: `You've been elected ${label}!`,
    message:
      `Congratulations, ${winnerName}! You have won the ${partyName} ${label} election. ` +
      `You now hold this national leadership position.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyNationalLeadershipLost(
  loserId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  loserName: string,
  winnerName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: loserId });
  if (!char) return;

  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;
  const label = getPartyRoleLabel(countryId, position);

  await createNotification({
    userId: char.userId,
    type: "national_leadership_lost",
    title: `${label} Election Result`,
    message:
      `The ${partyName} ${label} election has concluded. ` +
      `${winnerName} won the race. Better luck next time, ${loserName}.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyNationalLeadershipRemoved(
  holderId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, position);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Removed as ${label}`,
    message:
      `You have been replaced as ${label} of the national party ` +
      `following the conclusion of the leadership election.`,
    metadata: { partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyNationalLeadershipVacatedForNewRole(
  holderId: ObjectId,
  partyId: string,
  vacatedPosition: NationalPartyElectionPosition,
  newPosition: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const vacatedLabel = getPartyRoleLabel(countryId, vacatedPosition);
  const newLabel = getPartyRoleLabel(countryId, newPosition);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Vacated ${vacatedLabel} role`,
    message:
      `You have stepped down as ${vacatedLabel} of the national party ` +
      `after winning the ${newLabel} election. A character can hold ` +
      `only one national party leadership office at a time.`,
    metadata: {
      partyId,
      position: vacatedPosition,
      newPosition,
      recipientCharacterId: char._id.toString(),
    },
  });
}

async function notifyNationalLeadershipVacatedInactive(
  holderId: ObjectId,
  partyId: string,
  vacatedPosition: NationalPartyElectionPosition,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, vacatedPosition);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_removed",
    title: `Removed as ${label}`,
    message:
      `You have been removed as ${label} of the national party due to inactivity. ` +
      `The seat is now open for the next leadership election.`,
    metadata: {
      partyId,
      position: vacatedPosition,
      reason: "inactive",
      recipientCharacterId: char._id.toString(),
    },
  });
}

export async function notifyNationalLeadershipAppointed(
  characterId: ObjectId,
  partyId: string,
  position: NationalPartyElectionPosition,
  appointedByName: string,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  const label = getPartyRoleLabel(countryId, position);
  await createNotification({
    userId: char.userId,
    type: "national_leadership_appointed",
    title: `Appointed as ${label}`,
    message:
      `You have been appointed as ${label} of the national party ` + `by ${appointedByName}.`,
    metadata: { partyId, position },
  });
}

export async function notifyNationalCandidacyDeclared(
  partyId: string,
  position: NationalPartyElectionPosition,
  candidateName: string,
  candidateCharId: ObjectId,
  countryId: CountryId
): Promise<void> {
  const db = await getDb();
  const filter: Record<string, unknown> = {
    party: partyId,
    countryId,
    _id: { $ne: candidateCharId },
  };
  const members = await db
    .collection<Character>("characters")
    .find(filter)
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = getPartyRoleLabel(countryId, position);
  const party = await findPartyByElectionPartyId(db, partyId, countryId);
  const partyName = party?.name ?? partyId;

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "national_leadership_candidacy",
      title: `New ${label} Candidate`,
      message:
        `${candidateName} has declared their candidacy for ${label} ` +
        `of the ${partyName}. Cast your vote on the party page.`,
      metadata: { partyId, position, candidateName, recipientCharacterId: m._id.toString() },
    }))
  );
}
