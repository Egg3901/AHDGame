import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createNotification, createNotifications } from "@/lib/notifications";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import { isUserActive } from "@/lib/players/playerActivity";
import type {
  StatePartyElection,
  StatePartyElectionPosition,
  StatePartyVote,
  StatePartyCandidate,
  StatePartyOrg,
  PoliticalParty,
  Character,
  User,
  GameState,
} from "@/lib/db/types";
import { DEFAULT_LEGACY_COUNTRY_ID, type CountryId } from "@/lib/constants/countries";
import { createTurnBackedWindow } from "@/lib/time/turnBackedWindow";
import {
  resolveDefaultCycleEndTurn,
  type CycleAnchorCandidate,
} from "@/lib/elections/defaultCycleAnchor";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import { TERRITORY_ADMISSIONS } from "@/lib/elections/statehoodAdmission";
import { buildMajorPartyOrgsForState } from "@/lib/seeds/reference/statePartyOrg";

export const ELECTION_DURATION_TURNS = 72; // 72 turns = 72 hours

/**
 * Accelerated window used while `gameState.preIteration.active` — matches
 * {@link FOUNDING_CHAIR_ELECTION_DURATION_TURNS} on national party races.
 */
export const FOUNDING_STATE_ELECTION_DURATION_TURNS = 12;

export interface CreateMissingStateElectionsOptions {
  /** When true, stamp `founding: true` and skip shared-cycle anchoring. */
  founding?: boolean;
}

/**
 * Restore major-party chapters for residents of US territories that have not
 * yet been admitted. Territorial chapters elect party leadership only; the
 * statehood gates for public offices and legislative elections remain intact.
 *
 * This is normally satisfied by the seed, but worlds created before territorial
 * chapters were seeded can contain legacy residents without any party-org rows.
 */
async function ensureResidentTerritorialPartyOrgs(
  db: Db,
  parties: PoliticalParty[],
  statePartyOrgs: StatePartyOrg[],
  usPoliticalIds: ReadonlySet<string>,
  preset: string | undefined,
  now: Date
): Promise<StatePartyOrg[]> {
  const territoryIds = TERRITORY_ADMISSIONS.map((territory) => territory.stateId).filter(
    (stateId) => !usPoliticalIds.has(stateId)
  );
  if (territoryIds.length === 0) return statePartyOrgs;

  const residents = await db
    .collection<Character>("characters")
    .find({
      countryId: "US",
      homeState: { $in: territoryIds },
      party: { $exists: true, $nin: [null, ""] },
    })
    .project<Pick<Character, "homeState">>({ homeState: 1 })
    .toArray();
  const occupiedTerritories = new Set(
    residents
      .map((resident) => resident.homeState)
      .filter((stateId): stateId is string => !!stateId)
  );
  if (occupiedTerritories.size === 0) return statePartyOrgs;

  const usMajorParties = new Set(
    parties
      .filter((party) => (party.countryId ?? DEFAULT_LEGACY_COUNTRY_ID) === "US")
      .map((party) => String(party.sequentialId))
  );
  if (!usMajorParties.has("1") || !usMajorParties.has("2")) return statePartyOrgs;

  const existingOrgIds = new Set(statePartyOrgs.map((org) => org._id));
  const missingOrgs = Array.from(occupiedTerritories).flatMap((stateId) =>
    buildMajorPartyOrgsForState(stateId, preset).filter((org) => !existingOrgIds.has(org._id))
  );
  if (missingOrgs.length === 0) return statePartyOrgs;

  await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(
    missingOrgs.map((org) => ({
      updateOne: {
        filter: { _id: org._id },
        update: { $setOnInsert: { ...org, createdAt: now, updatedAt: now } },
        upsert: true,
      },
    }))
  );

  return [
    ...statePartyOrgs,
    ...missingOrgs.map((org) => ({ ...org, createdAt: now, updatedAt: now })),
  ];
}

async function isFoundingPhaseActive(db: Db): Promise<boolean> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preIteration: 1 } });
  return gameState?.preIteration?.active === true;
}

/**
 * Turns of inactivity (= real hours; one turn is one hour) before an inactive
 * state-party leadership holder (chair / vice chair / treasurer) is evicted
 * from their seat by {@link vacateInactiveLeadership}.
 *
 * Deliberately far more lenient than the 96-turn player-activity default
 * (`INACTIVE_PLAYER_TURN_THRESHOLD`): ≈ 2 weeks at 24 turns/day, so a short
 * absence (a weekend, a vacation) never churns a leader out of office. Only a
 * genuinely abandoned seat is vacated. State-party scope only — national party
 * leadership is intentionally NOT touched here.
 */
export const LEADERSHIP_INACTIVE_TURN_THRESHOLD = 336;

export const ALL_POSITIONS: StatePartyElectionPosition[] = ["chair", "viceChair", "treasurer"];

export const POSITION_LABELS: Record<StatePartyElectionPosition, string> = {
  chair: "State Chair",
  viceChair: "Vice Chair",
  treasurer: "Treasurer",
};

/** The statePartyOrg field that stores the holder for each position */
const POSITION_FIELD: Record<
  StatePartyElectionPosition,
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

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new leadership election for a state party position.
 * Resolution is keyed off game turns; wall-clock endTime is for display only.
 */
export async function createElection(
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition,
  currentTurn: number,
  durationTurns = ELECTION_DURATION_TURNS,
  countryId?: CountryId,
  effectiveNow = new Date(),
  options: CreateMissingStateElectionsOptions = {}
): Promise<ObjectId> {
  const db = await getDb();
  const now = new Date(effectiveNow);
  const window = createTurnBackedWindow({ currentTurn, durationTurns, effectiveNow: now });
  const founding = options.founding === true;

  const election: Omit<StatePartyElection, "_id"> = {
    stateId,
    partyId,
    countryId,
    position,
    status: "voting",
    startTime: window.startTime,
    endTime: window.endTime,
    startTurn: window.startTurn,
    endTurn: window.endTurn,
    durationTurns,
    ...(founding ? { founding: true as const } : {}),
    winnerId: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("statePartyElections").insertOne(election);

  console.log(
    `[StatePartyElections] Created ${position} election for ${stateId}_${partyId} ` +
      `(turns ${currentTurn}–${currentTurn + durationTurns})`
  );

  // Notify all state party members that a new election has opened
  await notifyMembersElectionOpened(
    stateId,
    partyId,
    countryId ?? DEFAULT_LEGACY_COUNTRY_ID,
    position,
    durationTurns
  );

  return result.insertedId;
}

// ─── Create Missing ──────────────────────────────────────────────────────────

/**
 * Ensure every state-party combination has an active election for each of the
 * three positions. Returns the count of elections created.
 *
 * Pass `{ founding: true }` during the pre-iteration founding phase so new
 * races are stamped `founding: true` (tenure/cooldown waived on enter/vote)
 * and use a fixed short window instead of the shared default cycle.
 */
export async function createMissingElections(
  currentTurn: number,
  durationTurns = ELECTION_DURATION_TURNS,
  effectiveNow = new Date(),
  countryId?: CountryId,
  options: CreateMissingStateElectionsOptions = {}
): Promise<number> {
  const db = await getDb();
  const now = new Date(effectiveNow);
  const founding = options.founding === true;
  const scopedStatePartyOrgQuery = applyOptionalCountryScope({}, countryId);
  const scopedActiveElectionQuery = applyOptionalCountryScope({ status: "voting" }, countryId);

  const [parties, initialStatePartyOrgs, activeElections, usPolitics] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
    db.collection<StatePartyOrg>("statePartyOrg").find(scopedStatePartyOrgQuery).toArray(),
    db
      .collection<StatePartyElection>("statePartyElections")
      .find(scopedActiveElectionQuery)
      .toArray(),
    loadUsPoliticalStateIds(db),
  ]);
  const statePartyOrgs = await ensureResidentTerritorialPartyOrgs(
    db,
    parties,
    initialStatePartyOrgs,
    usPolitics.politicalIds,
    usPolitics.preset,
    now
  );

  // Include countryId in key to prevent cross-country collisions
  const activeSet = new Set(
    activeElections.map((e) => `${e.countryId ?? "US"}:${e.stateId}_${e.partyId}_${e.position}`)
  );
  const partySet = new Set(
    parties.map((p) => `${p.countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${String(p.sequentialId)}`)
  );

  const toCreate: {
    stateId: string;
    partyId: string;
    countryId: CountryId;
    position: StatePartyElectionPosition;
  }[] = [];
  for (const org of statePartyOrgs) {
    const orgCountryId = org.countryId ?? DEFAULT_LEGACY_COUNTRY_ID;
    if (!partySet.has(`${orgCountryId}:${org.partyId}`)) continue;
    for (const position of ALL_POSITIONS) {
      const key = `${orgCountryId}:${org.stateId}_${org.partyId}_${position}`;
      if (!activeSet.has(key))
        toCreate.push({
          stateId: org.stateId,
          partyId: org.partyId,
          countryId: orgCountryId,
          position,
        });
    }
  }

  if (toCreate.length === 0) return 0;

  // Align new elections to the shared default cycle: an org appearing
  // mid-cycle (freshly chartered party, or an org whose election went
  // missing) joins the cadence every other default-duration state election
  // is on instead of starting its own drifting `currentTurn + duration`
  // window. Anchored to the modal endTurn of active default-duration
  // elections, memoized per country.
  //
  // Founding races skip anchoring — they use a fixed short window so the
  // pre-iteration phase can converge (same posture as national founding chairs).
  const anchorCandidates: CycleAnchorCandidate[] = founding
    ? []
    : activeElections.map((e) => ({
        countryId: e.countryId ?? DEFAULT_LEGACY_COUNTRY_ID,
        durationTurns: e.durationTurns,
        endTurn: e.endTurn,
      }));
  const windowByCountry = new Map<string, ReturnType<typeof createTurnBackedWindow>>();
  const windowFor = (electionCountryId: string) => {
    let w = windowByCountry.get(electionCountryId);
    if (!w) {
      const durationForCountry = founding
        ? durationTurns
        : resolveDefaultCycleEndTurn(anchorCandidates, {
            defaultDurationTurns: durationTurns,
            currentTurn,
            countryId: electionCountryId,
          }) - currentTurn;
      w = createTurnBackedWindow({
        currentTurn,
        durationTurns: durationForCountry,
        effectiveNow: now,
      });
      windowByCountry.set(electionCountryId, w);
    }
    return w;
  };

  const elections: Omit<StatePartyElection, "_id">[] = toCreate.map(
    ({ stateId, partyId, countryId, position }) => {
      const window = windowFor(countryId);
      return {
        stateId,
        partyId,
        countryId,
        position,
        status: "voting" as const,
        startTime: window.startTime,
        endTime: window.endTime,
        startTurn: window.startTurn,
        endTurn: window.endTurn,
        durationTurns: window.endTurn - currentTurn,
        ...(founding ? { founding: true as const } : {}),
        winnerId: null,
        createdAt: now,
        updatedAt: now,
      };
    }
  );

  await db
    .collection<StatePartyElection>("statePartyElections")
    .insertMany(elections as StatePartyElection[]);
  // Group positions by party so members get one consolidated notification.
  // Windows are per-country (shared cycle), so the entry carries the actual
  // duration for the message.
  const byParty = new Map<
    string,
    {
      stateId: string;
      partyId: string;
      countryId: CountryId;
      positions: StatePartyElectionPosition[];
      durationTurns: number;
    }
  >();
  for (const { stateId, partyId, countryId, position } of toCreate) {
    const key = `${countryId}:${stateId}_${partyId}`;
    const entry = byParty.get(key);
    if (entry) {
      entry.positions.push(position);
    } else {
      byParty.set(key, {
        stateId,
        partyId,
        countryId,
        positions: [position],
        durationTurns: windowFor(countryId).endTurn - currentTurn,
      });
    }
  }
  await Promise.all(
    Array.from(byParty.values()).map(({ stateId, partyId, countryId, positions, durationTurns }) =>
      notifyMembersElectionsOpenedBatch(stateId, partyId, countryId, positions, durationTurns)
    )
  );

  if (toCreate.length > 0) {
    console.log(
      `[StatePartyElections] Created ${toCreate.length} missing elections` +
        (founding ? " (founding)" : "")
    );
  }

  return toCreate.length;
}

// ─── Process Completed ───────────────────────────────────────────────────────

/**
 * Resolve elections whose endTurn <= currentTurn.
 * Updates statePartyOrg, sends winner/loser notifications.
 * Returns count of elections resolved.
 */
export async function processCompletedElections(
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
    .collection<StatePartyElection>("statePartyElections")
    .find(scopedEndedElectionQuery)
    .toArray();

  if (endedElections.length === 0) return 0;

  const electionIds = endedElections.map((e) => e._id);

  // Resolve banned characters once so we can drop their candidacies and votes
  // from the tally — defensive against accounts banned before the ban-time
  // cleanup helper shipped (or banned via direct DB edits).
  const bannedCharacterIds = await getBannedCharacterIds(db);
  const bannedVoterObjectIds = [...bannedCharacterIds].map((id) => new ObjectId(id));

  const voteMatch: Record<string, unknown> = { electionId: { $in: electionIds } };
  if (bannedVoterObjectIds.length > 0) {
    voteMatch.voterId = { $nin: bannedVoterObjectIds };
  }

  const [allCandidatesRaw, voteCountsByElection, orgs] = await Promise.all([
    db
      .collection<StatePartyCandidate>("statePartyCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    db
      .collection<StatePartyVote>("statePartyVotes")
      .aggregate<{ electionId: ObjectId; candidateId: ObjectId; count: number }>([
        { $match: voteMatch },
        { $sort: { votedAt: -1, _id: -1 } },
        {
          $group: {
            _id: { electionId: "$electionId", voterId: "$voterId" },
            candidateId: { $first: "$candidateId" },
          },
        },
        {
          $group: {
            _id: { electionId: "$_id.electionId", candidateId: "$candidateId" },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            electionId: "$_id.electionId",
            candidateId: "$_id.candidateId",
            count: 1,
            _id: 0,
          },
        },
      ])
      .toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ _id: { $in: endedElections.map((e) => `${e.stateId}_${e.partyId}`) } })
      .toArray(),
  ]);

  // Drop candidates owned by banned characters so they cannot win.
  const allCandidates = allCandidatesRaw.filter(
    (c) => !bannedCharacterIds.has(c.characterId.toString())
  );

  const candidatesByElection = new Map<string, StatePartyCandidate[]>();
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

  const voteCountsByElectionMap = new Map<string, { candidateId: ObjectId; count: number }[]>();
  for (const v of voteCountsByElection) {
    const key = v.electionId.toString();
    if (!activeCharIdsByElection.get(key)?.has(v.candidateId.toString())) continue;
    const list = voteCountsByElectionMap.get(key) ?? [];
    list.push({ candidateId: v.candidateId, count: v.count });
    voteCountsByElectionMap.set(key, list);
  }
  for (const list of voteCountsByElectionMap.values()) {
    list.sort((a, b) => b.count - a.count);
  }

  const orgMap = new Map(orgs.map((o) => [o._id as string, o]));

  const electionOps: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const orgOps: {
    updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const notifications: Promise<unknown>[] = [];

  // First pass: compute winners and queue election-status updates.
  // Org updates are deferred so we can consolidate multiple position changes
  // per org and auto-vacate any other office the winner currently holds.
  type WinningResult = {
    election: StatePartyElection;
    winnerId: ObjectId;
    winnerName: string;
    candidates: StatePartyCandidate[];
    topVoteCount: number;
  };
  const winningResults: WinningResult[] = [];

  for (const election of endedElections) {
    const { stateId, partyId, position } = election;
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
        `[StatePartyElections] ${stateId}_${partyId} ${position}: no candidates — position unchanged`
      );
    }
  }

  // Group winning results by org so multiple position changes for the same
  // org collapse into a single update — required for the cross-position
  // auto-vacate to interact correctly with same-batch winner assignments.
  const resultsByOrg = new Map<string, WinningResult[]>();
  for (const r of winningResults) {
    const orgKey = `${r.election.stateId}_${r.election.partyId}`;
    const list = resultsByOrg.get(orgKey) ?? [];
    list.push(r);
    resultsByOrg.set(orgKey, list);
  }

  for (const [orgKey, results] of resultsByOrg) {
    const org = orgMap.get(orgKey);
    const setUpdates: Record<string, unknown> = { updatedAt: now };

    const assignedFields = new Set<"chairId" | "viceChairId" | "treasurerId">();
    for (const r of results) {
      const field = POSITION_FIELD[r.election.position];
      setUpdates[field] = r.winnerId;
      assignedFields.add(field);
    }

    // Auto-vacate: if a winner currently holds another office in this org
    // (e.g. they were chair and just won vice chair), clear the prior office.
    // Skip fields being assigned by another election in the same batch — that
    // election's winner takes precedence over the vacate.
    for (const r of results) {
      for (const otherPos of ALL_POSITIONS) {
        if (otherPos === r.election.position) continue;
        const otherField = POSITION_FIELD[otherPos];
        if (assignedFields.has(otherField)) continue;
        const currentHolder = org?.[otherField];
        if (currentHolder && currentHolder.equals(r.winnerId)) {
          setUpdates[otherField] = null;
          notifications.push(
            notifyLeadershipVacatedForNewRole(
              r.winnerId,
              r.election.stateId,
              r.election.partyId,
              otherPos,
              r.election.position
            )
          );
        }
      }
    }

    orgOps.push({
      updateOne: { filter: { _id: orgKey }, update: { $set: setUpdates } },
    });

    for (const r of results) {
      const { election, winnerId, winnerName, candidates, topVoteCount } = r;
      const { stateId, partyId, position } = election;
      const field = POSITION_FIELD[position];
      const previousHolderId = org?.[field] ?? null;

      notifications.push(notifyLeadershipElected(winnerId, stateId, partyId, position, winnerName));
      notifications.push(
        import("@/lib/achievements")
          .then(async ({ awardAchievement, resolveUserIdFromCharacter }) => {
            const winnerUserId = await resolveUserIdFromCharacter(winnerId);
            if (winnerUserId) await awardAchievement(winnerUserId, "party_leader", winnerId);
          })
          .catch((e) => console.error("Achievement check failed:", e))
      );
      if (previousHolderId && !previousHolderId.equals(winnerId)) {
        notifications.push(notifyLeadershipRemoved(previousHolderId, stateId, partyId, position));
      }
      for (const cand of candidates) {
        if (!cand.characterId.equals(winnerId)) {
          notifications.push(
            notifyLeadershipLost(
              cand.characterId,
              stateId,
              partyId,
              position,
              cand.characterName,
              winnerName
            )
          );
        }
      }
      console.log(
        `[StatePartyElections] ${stateId}_${partyId} ${position}: ${winnerName} elected (${topVoteCount} votes)`
      );
    }
  }

  await db.collection<StatePartyElection>("statePartyElections").bulkWrite(electionOps);

  // Terminalize the resolved elections' candidacies. The candidate docs are
  // read for the tally above (status:"active"), so this must run afterward.
  // Without it they linger as "active" and trip the per-(state,party) unique
  // index, blocking the character from declaring in the next cycle's election
  // ("already running… withdraw first") with no UI path to clear them.
  await db
    .collection<StatePartyCandidate>("statePartyCandidates")
    .updateMany(
      { electionId: { $in: electionIds }, status: "active" },
      { $set: { status: "completed", resolvedAt: now } }
    );

  if (orgOps.length > 0) {
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(orgOps);
  }
  await Promise.all(notifications);

  if (endedElections.length > 0) {
    console.log(`[StatePartyElections] Resolved ${endedElections.length} elections`);
  }

  return endedElections.length;
}

// ─── Vacate inactive leadership ──────────────────────────────────────────────

/**
 * Evict genuinely inactive holders from state-party leadership seats.
 *
 * Root cause this fixes: when a leadership election resolves with no candidates,
 * {@link processCompletedElections} leaves the incumbent in place unconditionally
 * — there was no inactivity-based eviction anywhere, so an abandoned chair could
 * hold a seat indefinitely (ticket #972: NJ Democratic chair inactive ~869h).
 *
 * For every `statePartyOrg` seat (chair / vice chair / treasurer) whose holder's
 * user fails {@link isUserActive} at the lenient
 * {@link LEADERSHIP_INACTIVE_TURN_THRESHOLD}, the seat field is `$set` to `null`
 * and the existing leadership-removed notification is emitted. Callers run this
 * BEFORE `createMissingElections` so the next cycle opens against an empty seat.
 *
 * Batched: exactly one `characters` find and one `users` find over the collected
 * holder ids (never per-seat). Fully inert when everything is active — no writes,
 * no notifications. Data gaps never punish a holder: a missing character or user,
 * or missing activity timestamps, is treated as active (skip-on-missing, matching
 * `activeUserIds`). State-party scope only.
 *
 * @returns the number of seats vacated.
 */
export async function vacateInactiveLeadership(
  db: Db,
  currentTurn: number,
  effectiveNow: Date = new Date()
): Promise<number> {
  const now = new Date(effectiveNow);

  // 1. Orgs with at least one occupied seat.
  const orgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      $or: [
        { chairId: { $ne: null } },
        { viceChairId: { $ne: null } },
        { treasurerId: { $ne: null } },
      ],
    })
    .toArray();
  if (orgs.length === 0) return 0;

  // 2. Collect every distinct holder character id, then batch-resolve
  //    characters → users (ONE find each).
  const holderIdByHex = new Map<string, ObjectId>();
  for (const org of orgs) {
    for (const position of ALL_POSITIONS) {
      const holder = org[POSITION_FIELD[position]];
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

  // A holder is inactive only when we can positively resolve char → user AND
  // that user fails the lenient activity check. Missing data → treat as active.
  const isHolderInactive = (holder: ObjectId): boolean => {
    const userId = userIdByCharHex.get(holder.toString());
    if (!userId) return false; // no character/user record — never punish gaps
    const user = userByHex.get(userId.toString());
    if (!user) return false;
    return !isUserActive(
      user.lastActivity,
      user.createdAt,
      now,
      LEADERSHIP_INACTIVE_TURN_THRESHOLD
    );
  };

  // 3. Null out inactive seats (one bulk update per org) + notify.
  const orgOps: {
    updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const notifications: Promise<unknown>[] = [];
  let vacated = 0;

  for (const org of orgs) {
    const setUpdates: Record<string, unknown> = {};
    for (const position of ALL_POSITIONS) {
      const field = POSITION_FIELD[position];
      const holder = org[field];
      if (!holder || !isHolderInactive(holder)) continue;
      setUpdates[field] = null;
      vacated += 1;
      notifications.push(notifyLeadershipRemoved(holder, org.stateId, org.partyId, position));
      console.log(
        `[StatePartyElections] Vacated inactive ${position} for ${org._id} ` +
          `(holder ${holder.toString()}, turn ${currentTurn})`
      );
    }
    if (Object.keys(setUpdates).length > 0) {
      setUpdates.updatedAt = now;
      orgOps.push({
        updateOne: { filter: { _id: org._id as string }, update: { $set: setUpdates } },
      });
    }
  }

  if (orgOps.length > 0) {
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(orgOps);
    await Promise.all(notifications);
    console.log(`[StatePartyElections] Vacated ${vacated} inactive leadership seat(s)`);
  }

  return vacated;
}

// ─── Main entry point (called from turn system) ──────────────────────────────

export async function processStatePartyElections(
  currentTurn: number,
  effectiveNow = new Date()
): Promise<{
  electionsCreated: number;
  electionsCompleted: number;
}> {
  try {
    const electionsCompleted = await processCompletedElections(currentTurn, effectiveNow);
    // Evict genuinely inactive holders BEFORE opening new elections, so a
    // freshly-vacated seat's next election opens against an empty seat (#972).
    const db = await getDb();
    await vacateInactiveLeadership(db, currentTurn, effectiveNow);
    const founding = await isFoundingPhaseActive(db);
    const electionsCreated = await createMissingElections(
      currentTurn,
      founding ? FOUNDING_STATE_ELECTION_DURATION_TURNS : ELECTION_DURATION_TURNS,
      effectiveNow,
      undefined,
      { founding }
    );
    return { electionsCreated, electionsCompleted };
  } catch (error) {
    console.error("[StatePartyElections] Error:", error);
    return { electionsCreated: 0, electionsCompleted: 0 };
  }
}

// ─── Init (seeding) ──────────────────────────────────────────────────────────

export async function initializeElections(
  currentTurn: number,
  effectiveNow = new Date()
): Promise<number> {
  const db = await getDb();
  const founding = await isFoundingPhaseActive(db);
  const created = await createMissingElections(
    currentTurn,
    founding ? FOUNDING_STATE_ELECTION_DURATION_TURNS : ELECTION_DURATION_TURNS,
    effectiveNow,
    undefined,
    { founding }
  );
  if (created > 0) {
    console.log(
      `[StatePartyElections] Initialized ${created} elections` + (founding ? " (founding)" : "")
    );
  }
  return created;
}

// ─── Notification helpers ────────────────────────────────────────────────────

async function notifyMembersElectionOpened(
  stateId: string,
  partyId: string,
  countryId: CountryId,
  position: StatePartyElectionPosition,
  durationTurns: number
): Promise<void> {
  const db = await getDb();
  const members = await db
    .collection<Character>("characters")
    .find({ homeState: stateId, party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = POSITION_LABELS[position];
  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "leadership_election_opened",
      title: `${label} Election Open`,
      message:
        `A new ${label} election has opened for the ${stateId} party. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the state party page.`,
      metadata: { stateId, partyId, position, recipientCharacterId: m._id.toString() },
    }))
  );
}

async function notifyMembersElectionsOpenedBatch(
  stateId: string,
  partyId: string,
  countryId: CountryId,
  positions: StatePartyElectionPosition[],
  durationTurns: number
): Promise<void> {
  const db = await getDb();
  const members = await db
    .collection<Character>("characters")
    .find({ homeState: stateId, party: partyId, countryId })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const labels = positions.map((p) => POSITION_LABELS[p]);
  const positionList =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const title = positions.length === 1 ? `${labels[0]} Election Open` : "Leadership Elections Open";

  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "leadership_election_opened",
      title,
      message:
        `New ${positionList} elections have opened for the ${stateId} party. ` +
        `Voting is open for ${durationTurns} turns. Declare your candidacy or cast your vote on the state party page.`,
      metadata: { stateId, partyId, positions, recipientCharacterId: m._id.toString() },
    }))
  );
}

async function notifyLeadershipElected(
  winnerId: ObjectId,
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition,
  winnerName: string
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: winnerId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_elected",
    title: `You've been elected ${POSITION_LABELS[position]}!`,
    message:
      `Congratulations, ${winnerName}! You have won the ${stateId} party ${POSITION_LABELS[position]} election. ` +
      `You now hold this leadership position.`,
    metadata: { stateId, partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyLeadershipLost(
  loserId: ObjectId,
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition,
  loserName: string,
  winnerName: string
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: loserId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_lost",
    title: `${POSITION_LABELS[position]} Election Result`,
    message:
      `The ${stateId} party ${POSITION_LABELS[position]} election has concluded. ` +
      `${winnerName} won the race. Better luck next time, ${loserName}.`,
    metadata: { stateId, partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyLeadershipRemoved(
  holderId: ObjectId,
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_removed",
    title: `Removed as ${POSITION_LABELS[position]}`,
    message:
      `You have been replaced as ${POSITION_LABELS[position]} of the ${stateId} party ` +
      `following the conclusion of the leadership election.`,
    metadata: { stateId, partyId, position, recipientCharacterId: char._id.toString() },
  });
}

async function notifyLeadershipVacatedForNewRole(
  holderId: ObjectId,
  stateId: string,
  partyId: string,
  vacatedPosition: StatePartyElectionPosition,
  newPosition: StatePartyElectionPosition
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: holderId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_removed",
    title: `Vacated ${POSITION_LABELS[vacatedPosition]} role`,
    message:
      `You have stepped down as ${POSITION_LABELS[vacatedPosition]} of the ${stateId} party ` +
      `after winning the ${POSITION_LABELS[newPosition]} election. A character can hold only one ` +
      `state party leadership office at a time.`,
    metadata: {
      stateId,
      partyId,
      position: vacatedPosition,
      newPosition,
      recipientCharacterId: char._id.toString(),
    },
  });
}

export async function notifyLeadershipAppointed(
  characterId: ObjectId,
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition,
  appointedByName: string
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_appointed",
    title: `Appointed as ${POSITION_LABELS[position]}`,
    message:
      `You have been appointed as ${POSITION_LABELS[position]} of the ${stateId} party ` +
      `by ${appointedByName}.`,
    metadata: { stateId, partyId, position, recipientCharacterId: characterId.toString() },
  });
}

export async function notifyLeadershipRemovedByAdmin(
  characterId: ObjectId,
  stateId: string,
  partyId: string,
  position: StatePartyElectionPosition
): Promise<void> {
  const db = await getDb();
  const char = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!char) return;

  await createNotification({
    userId: char.userId,
    type: "leadership_removed",
    title: `Removed as ${POSITION_LABELS[position]}`,
    message:
      `You have been removed from the position of ${POSITION_LABELS[position]} ` +
      `in the ${stateId} party by an administrator.`,
    metadata: { stateId, partyId, position, recipientCharacterId: char._id.toString() },
  });
}

export async function notifyCandidacyDeclared(
  stateId: string,
  partyId: string,
  countryId: CountryId,
  position: StatePartyElectionPosition,
  candidateName: string,
  candidateCharId: ObjectId
): Promise<void> {
  const db = await getDb();
  const members = await db
    .collection<Character>("characters")
    .find({ homeState: stateId, party: partyId, countryId, _id: { $ne: candidateCharId } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const label = POSITION_LABELS[position];
  await createNotifications(
    members.map((m) => ({
      userId: m.userId,
      type: "leadership_candidacy",
      title: `New ${label} Candidate`,
      message:
        `${candidateName} has declared their candidacy for ${label} ` +
        `of the ${stateId} party. Cast your vote on the state party page.`,
      metadata: {
        stateId,
        partyId,
        position,
        candidateName,
        recipientCharacterId: m._id.toString(),
      },
    }))
  );
}
