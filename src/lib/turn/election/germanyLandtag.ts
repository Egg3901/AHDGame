/**
 * German Landtag election engine.
 *
 * Each of the 16 Bundesländer has its own Landtag (state legislature) with a
 * staggered 5-year canonical cycle anchored to the real-world election year
 * for that Land. Resolution uses Sainte-Laguë proportional allocation with a
 * 5% Land-level threshold. Player candidates fill their party's allocated
 * seats in vote-share order before NPPs.
 *
 * Two entry points:
 *   - ensureDELandtagElections(now): perpetual spawner; one Election doc per Land
 *   - resolveDELandtagElection(db, election, now): proportional allocator;
 *     called from generalResolution.ts when an expired Landtag election needs
 *     to be resolved (replaces the FPTP path for this electionType).
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { getSeatIdFromElection } from "@/lib/seats";
import { getLandtagAnchor } from "@/lib/seeds/de/deLandtag";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { allocateViaSainteLague } from "./sainteLagueAllocation";
import type {
  State,
  Election,
  ElectionStatus,
  ElectionVoteTally,
  ElectionCandidate,
  ElectedOfficial,
  GameState,
  NPP,
  Character,
} from "@/lib/db/types";
import type { CareerEvent } from "@/lib/db/types/character";
import { logger } from "../../observability/logger";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const LANDTAG_THRESHOLD = 0.05;

async function getCurrentTurnAndCtx(db: Db): Promise<{
  currentTurn: number;
  ctx: import("@/lib/elections/cycleAnchorContext").CycleAnchorContext;
  preset: string;
}> {
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const { cycleAnchorContextFromGameState } = await import("@/lib/elections/cycleAnchorContext");
  return {
    currentTurn: gs?.currentTurn ?? 1,
    ctx: cycleAnchorContextFromGameState(gs),
    preset: gs?.preset ?? DEFAULT_SEED_PRESET,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawner: one Landtag election per Land using staggered canonical anchors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure each Bundesland has a live or upcoming Landtag election. Per-Land
 * canonical anchors come from getLandtagAnchor() (real-world election years
 * rounded to year boundaries). Cycle period is 240 turns (5 game-years).
 */
export async function ensureDELandtagElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx, preset } = await getCurrentTurnAndCtx(db);

  const deLaender = await db
    .collection<State>("states")
    .find({ countryId: "DE" }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  if (deLaender.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: "landtag",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveLandtag = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: "landtag",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(landId: string): Election | undefined {
    return completedElections.find((e) => e.state === landId);
  }

  const dur = DEFAULT_DURATIONS.landtag.durationHours;
  const genDur = DEFAULT_DURATIONS.landtag.generalDurationHours;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const land of deLaender) {
    const landId = land._id as string;
    if (liveLandtag.has(landId)) continue;

    const customAnchor = getLandtagAnchor(landId, preset);
    if (customAnchor === undefined) continue; // unknown Land — skip silently

    const prev = lastCompleted(landId);
    const spawn = pickNextCanonicalCycle({
      electionType: "landtag",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      customCycle1EndTurn: customAnchor,
      ctx,
    });
    if (!spawn) continue;

    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId: "DE",
      electionType: "landtag",
      state: landId,
      seatId: getSeatIdFromElection({
        countryId: "DE",
        electionType: "landtag",
        state: landId,
      }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("landtag", spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? land.stateSenateSeats ?? 1,
      startTime: now,
      primaryEndTime,
      endTime,
      startTurn: currentTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur,
      primaryDurationHours: dur - genDur,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  // Guard against duplicates (mirror ensureDEElections)
  const orFilters = toInsert.map((e) => ({
    electionType: "landtag" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureDELandtagElections: spawned ${toActuallyInsert.length} missing Landtag election(s)`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minister-President spawner — paired with each Land's Landtag election
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure each Bundesland has a live or upcoming Minister-President election.
 *
 * Mirrors the timing of the Land's Landtag election so the new MP is decided
 * on the same cadence as the new state parliament — matching RL practice
 * where the new majority appoints the MP after each Landtag race. Falls back
 * to canonical anchoring when no Landtag election exists yet (e.g. fresh
 * seed before the first Landtag spawn).
 *
 * Must run AFTER `ensureDELandtagElections` in the turn-phase registry so
 * the Landtag election is already in the DB to mirror.
 */
export async function ensureDEMinisterPresidentElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx, preset } = await getCurrentTurnAndCtx(db);

  const deLaender = await db
    .collection<State>("states")
    .find({ countryId: "DE" }, { projection: { _id: 1 } })
    .toArray();
  if (deLaender.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: "ministerPresident",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveMP = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: "ministerPresident",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(landId: string): Election | undefined {
    return completedElections.find((e) => e.state === landId);
  }

  // Sync against any active/upcoming Landtag election for the same Land —
  // MP election timing mirrors the Landtag's (same primaryEndTime, endTime).
  const liveLandtagElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: "landtag",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const landtagByLand = new Map(liveLandtagElections.map((e) => [e.state, e]));

  const dur = DEFAULT_DURATIONS.ministerPresident.durationHours;
  const genDur = DEFAULT_DURATIONS.ministerPresident.generalDurationHours;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const land of deLaender) {
    const landId = land._id as string;
    if (liveMP.has(landId)) continue;

    const prev = lastCompleted(landId);
    const landtag = landtagByLand.get(landId);

    // Preferred path: mirror the Landtag election's timestamps exactly so
    // both close on the same tick and the new majority appoints the MP at
    // the same moment they take their seats.
    if (landtag?.startTime && landtag?.primaryEndTime && landtag?.endTime) {
      // Mirror the Landtag's CYCLE too, not just its timestamps. Hardcoding
      // prev+1 made every Minister-President race spawn as cycle 1 during the
      // pre-iteration founding phase (measured: 11/11 Länder), which mislabels
      // its LARP year — `electionToLarpYear(cycle 0)` is the era's starting
      // year — and permanently offsets the Land's MP cycle numbering from the
      // Landtag it is supposed to track. Same bug class as the UK regional
      // council mirror path (see `councilCycle` in perpetualElections.ts).
      const mpCycle = ctx.preIterationActive ? 0 : (prev?.cycle ?? 0) + 1;
      toInsert.push({
        countryId: "DE",
        electionType: "ministerPresident",
        state: landId,
        seatId: getSeatIdFromElection({
          countryId: "DE",
          electionType: "ministerPresident",
          state: landId,
        }),
        cycle: mpCycle,
        electionYear: electionToLarpYear("ministerPresident", mpCycle, undefined, undefined, ctx),
        status: landtag.status as "active" | "upcoming",
        totalSeats: 1,
        startTime: landtag.startTime,
        primaryEndTime: landtag.primaryEndTime,
        endTime: landtag.endTime,
        startTurn: landtag.startTurn,
        primaryEndTurn: landtag.primaryEndTurn,
        endTurn: landtag.endTurn,
        durationHours: dur,
        primaryDurationHours: dur - genDur,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    // Fallback: no live Landtag for this Land — spawn on the canonical MP
    // cycle directly. Same anchor data as Landtag so they'll re-align on
    // the next pass once the Landtag spawner catches up.
    const customAnchor = getLandtagAnchor(landId, preset);
    if (customAnchor === undefined) continue;

    const spawn = pickNextCanonicalCycle({
      electionType: "ministerPresident",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      customCycle1EndTurn: customAnchor,
      ctx,
    });
    if (!spawn) continue;

    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId: "DE",
      electionType: "ministerPresident",
      state: landId,
      seatId: getSeatIdFromElection({
        countryId: "DE",
        electionType: "ministerPresident",
        state: landId,
      }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("ministerPresident", spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: 1,
      startTime: now,
      primaryEndTime,
      endTime,
      startTurn: currentTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur,
      primaryDurationHours: dur - genDur,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  // Guard against duplicates (mirror ensureDELandtagElections)
  const orFilters = toInsert.map((e) => ({
    countryId: "DE" as const,
    electionType: "ministerPresident" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureDEMinisterPresidentElections: spawned ${toActuallyInsert.length} missing MP election(s)`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver: Sainte-Laguë proportional allocation per Land
// ─────────────────────────────────────────────────────────────────────────────

export interface LandtagSeatAssignment {
  candidateId: string;
  partyId: string;
  votes: number;
  seats: number;
  candidate: ElectionCandidate;
}

export interface LandtagSeatResolution {
  assignments: LandtagSeatAssignment[];
  seatsEstimate: Record<string, number>;
  partySeats: Record<string, number>;
  seatsAllocated: number;
}

function allocateCandidateSeatsWithinParty(
  partyCandidates: Array<{ candidateId: string; votes: number }>,
  seatsToAllocate: number
): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const candidate of partyCandidates) seats[candidate.candidateId] = 0;

  if (seatsToAllocate <= 0 || partyCandidates.length === 0) return seats;
  if (partyCandidates.length === 1) {
    seats[partyCandidates[0].candidateId] = seatsToAllocate;
    return seats;
  }

  const totalVotes = partyCandidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  if (totalVotes <= 0) {
    for (let i = 0; i < seatsToAllocate; i++) {
      seats[partyCandidates[i % partyCandidates.length].candidateId]++;
    }
    return seats;
  }

  const raw = partyCandidates.map(({ candidateId, votes }) => {
    const exact = (votes / totalVotes) * seatsToAllocate;
    return {
      candidateId,
      votes,
      seats: Math.floor(exact),
      remainder: exact % 1,
    };
  });

  let assigned = raw.reduce((sum, candidate) => sum + candidate.seats, 0);
  raw
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.candidateId.localeCompare(b.candidateId);
    })
    .forEach((candidate) => {
      if (assigned >= seatsToAllocate) return;
      candidate.seats++;
      assigned++;
    });

  for (const candidate of raw) {
    seats[candidate.candidateId] = candidate.seats;
  }
  return seats;
}

export function allocateLandtagSeatsToCandidates(
  candidates: ElectionCandidate[],
  tally: ElectionVoteTally,
  totalSeats: number
): LandtagSeatResolution {
  const candidateById = new Map(candidates.map((c) => [c._id.toString(), c]));
  const votesByParty = new Map<string, number>();
  const candidatesByParty = new Map<string, Array<{ candidateId: string; votes: number }>>();
  const seatsEstimate: Record<string, number> = {};

  for (const candidate of candidates) {
    seatsEstimate[candidate._id.toString()] = 0;
  }

  for (const [candidateId, votes] of Object.entries(tally.totalVotes)) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) continue;
    const partyId = candidate.party ?? "independent";
    votesByParty.set(partyId, (votesByParty.get(partyId) ?? 0) + votes);
    if (!candidatesByParty.has(partyId)) candidatesByParty.set(partyId, []);
    candidatesByParty.get(partyId)!.push({ candidateId, votes });
  }

  if (votesByParty.size === 0) {
    return { assignments: [], seatsEstimate, partySeats: {}, seatsAllocated: 0 };
  }

  const allocation = allocateViaSainteLague(
    Array.from(votesByParty.entries()).map(([partyId, votes]) => ({ partyId, votes })),
    totalSeats,
    { minVoteShare: LANDTAG_THRESHOLD }
  );

  const assignments: LandtagSeatAssignment[] = [];
  for (const [partyId, partySeats] of Object.entries(allocation.partySeats)) {
    if (partySeats <= 0) continue;
    const partyCandidates = [...(candidatesByParty.get(partyId) ?? [])].sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.candidateId.localeCompare(b.candidateId);
    });
    const candidateSeatMap = allocateCandidateSeatsWithinParty(partyCandidates, partySeats);

    for (const partyCandidate of partyCandidates) {
      const seats = candidateSeatMap[partyCandidate.candidateId] ?? 0;
      seatsEstimate[partyCandidate.candidateId] = seats;
      if (seats <= 0) continue;
      const candidate = candidateById.get(partyCandidate.candidateId);
      if (!candidate) continue;
      assignments.push({
        candidateId: partyCandidate.candidateId,
        partyId,
        votes: partyCandidate.votes,
        seats,
        candidate,
      });
    }
  }

  return {
    assignments,
    seatsEstimate,
    partySeats: allocation.partySeats,
    seatsAllocated: assignments.reduce((sum, assignment) => sum + assignment.seats, 0),
  };
}

async function sweepStaleLandtagOffice(db: Db, landId: string, now: Date): Promise<void> {
  const current = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: "landtag", state: landId }, { projection: { characterId: 1, nppId: 1 } })
    .toArray();

  const currentCharIds = current.filter((o) => o.characterId).map((o) => o.characterId!);
  const currentNppIds = current.filter((o) => o.nppId).map((o) => o.nppId!);
  const officeMatch = { "currentOffice.type": "landtag", "currentOffice.state": landId };

  await db.collection<Character>("characters").updateMany(
    {
      ...officeMatch,
      ...(currentCharIds.length > 0 ? { _id: { $nin: currentCharIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );

  await db.collection<NPP>("npps").updateMany(
    {
      ...officeMatch,
      ...(currentNppIds.length > 0 ? { _id: { $nin: currentNppIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );
}

/**
 * Resolve an expired Landtag election. Replaces the default FPTP path in
 * generalResolution.ts when electionType === "landtag" and countryId === "DE".
 *
 * Algorithm:
 *   1. Aggregate vote totals per party across all candidates.
 *   2. Apply 5% Land-level threshold via allocateViaSainteLague's minVoteShare.
 *   3. Per qualifying party, distribute its allocated seats across that party's
 *      candidates by personal vote totals.
 *
 * A candidate can hold multiple seats. That matches the app's multi-seat model,
 * where one electedOfficials row may represent a party bloc via seatsHeld.
 */
export async function resolveDELandtagElection(
  db: Db,
  election: Election,
  now: Date
): Promise<{ winnersAllocated: number; seatsAllocated: number }> {
  if (election.countryId !== "DE" || election.electionType !== "landtag") {
    throw new Error(
      `resolveDELandtagElection called with wrong electionType/country: ` +
        `${election.countryId}/${election.electionType}`
    );
  }

  const totalSeats = election.totalSeats ?? 1;
  const landId = election.state;

  // Vote tallies for this election (per-candidate vote totals)
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: election._id });
  if (!tally) {
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .deleteMany({ officeType: "landtag", state: landId });
    await sweepStaleLandtagOffice(db, landId, now);
    logger.warn("Landtag", `No vote tally for ${landId} cycle ${election.cycle}`);
    return { winnersAllocated: 0, seatsAllocated: 0 };
  }

  // Candidate docs need party affiliation + isNPP/characterId for seating.
  // Load by tally IDs so finalized/withdrawn elections can be safely healed.
  const tallyCandidateObjectIds = Object.keys(tally.totalVotes)
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: tallyCandidateObjectIds }, electionId: election._id })
    .toArray();

  // Defense-in-depth: never seat a hard-deleted character. Account deletion can
  // leave a dangling candidacy that resolves into a phantom list seat (the NW
  // Landtag "Wolfgang Clement" case). Drop non-NPP candidates whose character
  // no longer exists so their votes and seats fall to the remaining eligible
  // candidates. Mirrors the FPTP guard in generalResolution.ts.
  let liveCandidates = candidates;
  const candidateCharIds = candidates
    .filter((c): c is typeof c & { characterId: ObjectId } => !c.isNPP && !!c.characterId)
    .map((c) => c.characterId);
  if (candidateCharIds.length > 0) {
    const existingChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: candidateCharIds } }, { projection: { _id: 1 } })
      .toArray();
    const existingCharIds = new Set(existingChars.map((c) => c._id.toString()));
    liveCandidates = candidates.filter(
      (c) => c.isNPP || !c.characterId || existingCharIds.has(c.characterId.toString())
    );
    if (liveCandidates.length !== candidates.length) {
      console.warn(
        `[Landtag] ${landId} cycle ${election.cycle}: excluding ` +
          `${candidates.length - liveCandidates.length} candidate(s) whose character no longer exists`
      );
    }
  }

  const seatResolution = allocateLandtagSeatsToCandidates(liveCandidates, tally, totalSeats);

  // Fill each party's seats by candidate vote share (player and NPP equal-footing).
  // Mirrors generalResolution.ts behavior for multi-seat paths: insert ElectedOfficial,
  // then update the winner's NPP.currentOffice or Character.currentOffice + careerHistory.
  const officialsToInsert: ElectedOfficial[] = [];
  const winnerActions: Array<() => Promise<void>> = [];
  for (const assignment of seatResolution.assignments) {
    const { candidate, partyId, seats } = assignment;
    const office = { type: "landtag" as const, state: landId, seatsHeld: seats };
    const official: ElectedOfficial = {
      _id: new ObjectId(),
      countryId: "DE",
      officeType: "landtag",
      state: landId,
      isAppointment: false,
      seatsHeld: seats,
      characterId: candidate.isNPP ? null : (candidate.characterId ?? null),
      characterName: candidate.characterName,
      party: partyId,
      isNPP: candidate.isNPP ?? false,
      nppId: candidate.nppId,
      electedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    officialsToInsert.push(official);

    // Defer NPP/Character writes until after the bulk insert completes
    if (candidate.isNPP && candidate.nppId) {
      const nppId = candidate.nppId;
      winnerActions.push(async () => {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: nppId },
            { $set: { currentOffice: office, party: partyId, updatedAt: now } }
          );
      });
    } else if (!candidate.isNPP && candidate.characterId) {
      const charId = candidate.characterId;
      const careerEvent: CareerEvent = {
        type: "elected",
        office,
        officeLabel: `Member of Landtag (${landId})`,
        party: partyId,
        partyCountryId: "DE",
        electionId: election._id.toString(),
        date: now,
      };
      winnerActions.push(async () => {
        await db.collection<Character>("characters").updateOne(
          { _id: charId },
          {
            $set: { currentOffice: office, updatedAt: now },
            $push: { careerHistory: careerEvent },
          }
        );
      });
    }
  }

  await db
    .collection<ElectedOfficial>("electedOfficials")
    .deleteMany({ officeType: "landtag", state: landId });

  if (officialsToInsert.length > 0) {
    await db.collection<ElectedOfficial>("electedOfficials").insertMany(officialsToInsert);
  }

  // Apply NPP/Character currentOffice updates after the officials insert
  for (const action of winnerActions) {
    await action();
  }

  await sweepStaleLandtagOffice(db, landId, now);

  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { _id: tally._id },
    {
      $set: {
        seatsEstimate: seatResolution.seatsEstimate,
        updatedAt: now,
      },
    }
  );

  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  return {
    winnersAllocated: officialsToInsert.length,
    seatsAllocated: seatResolution.seatsAllocated,
  };
}
