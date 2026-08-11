import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import type { DebateParticipant, DebateSession } from "@/lib/db/types/debateSession";
import { getDebateSessionsCollection } from "@/lib/db/collections/debateSessions";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import { STAT_KEYS, NEUTRAL_STAT, STAT_MAX, type CharacterStats } from "@/lib/stats/statsConstants";
import { rollDebatePractice } from "@/lib/stats/debatePrep";
import {
  pickAiStrategies,
  DEBATE_STRATEGY_DEADLINE_MS,
  type DebateRecord,
  type DebateStrategy,
} from "./debateScoring";
import { resolveDebateSession } from "./resolveDebateSession";

/** Neutral stat block for participants without an allocated sheet (unmigrated / NPP). */
function neutralStats(): CharacterStats {
  return STAT_KEYS.reduce((acc, k) => {
    acc[k] = NEUTRAL_STAT;
    return acc;
  }, {} as CharacterStats);
}

/** Derive a debate record from a character (offices held; bills-passed is a future hook). */
export function characterDebateRecord(
  character: Pick<Character, "careerHistory" | "currentOffice">
): DebateRecord {
  const elected = character.careerHistory?.filter((e) => e.type === "elected").length ?? 0;
  const officesHeld = elected > 0 ? elected : character.currentOffice ? 1 : 0;
  // billsPassed is not cheaply available here; offices already differentiate
  // incumbents. Left at 0 as a documented tunable (Tout leans on officesHeld).
  return { officesHeld, billsPassed: 0 };
}

/**
 * Build a participant from a player character, snapshotting stats + record.
 * Human candidates always get the interactive (`pvp`) side with no pre-picked
 * strategies — the 12h strategy deadline is what gives them time to respond,
 * and `sweepExpiredDebates` AI-fills any side that doesn't submit in time.
 */
export function buildCharacterParticipant(
  character: Pick<Character, "_id" | "name" | "stats" | "careerHistory" | "currentOffice">
): DebateParticipant {
  const stats = character.stats ?? neutralStats();
  const record = characterDebateRecord(character);
  return {
    kind: "character",
    characterId: character._id,
    name: character.name,
    stats,
    record,
    mode: "pvp",
    strategies: null,
  };
}

/** Build an NPP (or non-character) participant — always AI-resolved from neutral stats. */
export function buildNppParticipant(npp: { _id: ObjectId; name: string }): DebateParticipant {
  const stats = neutralStats();
  const record: DebateRecord = { officesHeld: 1, billsPassed: 0 };
  return {
    kind: "npp",
    nppId: npp._id,
    name: npp.name,
    stats,
    record,
    mode: "ai",
    strategies: pickAiStrategies({ stats, record }),
  };
}

/**
 * Supersede pending PREE events for the involved player characters — the debate
 * takes their one pending slot so it can't collide with another random event.
 */
async function supersedePendingEvents(db: Db, characterIds: ObjectId[], now: Date): Promise<void> {
  if (characterIds.length === 0) return;
  await getEventInstancesCollection(db).updateMany(
    { scope: "character", scopeId: { $in: characterIds }, status: "pending" },
    { $set: { status: "expired", resolvedAt: now, resolveReason: "timeout", updatedAt: now } }
  );
}

export interface CreateDebateChallengeInput {
  electionId: ObjectId;
  countryId: CountryId;
  challenger: DebateParticipant;
  opponent: DebateParticipant;
  currentTurn: number;
  now: Date;
}

/**
 * Create a debate session and supersede the involved players' pending PREE
 * events. Returns the inserted session.
 */
export async function createDebateChallenge(
  db: Db,
  input: CreateDebateChallengeInput
): Promise<DebateSession> {
  const { challenger, opponent, now } = input;
  const playerIds = [challenger, opponent]
    .filter((p) => p.kind === "character" && p.characterId)
    .map((p) => p.characterId!);
  await supersedePendingEvents(db, playerIds, now);

  const session: DebateSession = {
    _id: new ObjectId(),
    electionId: input.electionId,
    countryId: input.countryId,
    status: "awaitingStrategies",
    challenger,
    opponent,
    createdTurn: input.currentTurn,
    createdAt: now,
    deadlineRealtimeMs: now.getTime() + DEBATE_STRATEGY_DEADLINE_MS,
    updatedAt: now,
  };
  await getDebateSessionsCollection(db).insertOne(session);
  return session;
}

/** Clamp-add favorability on a character or NPP doc. */
async function applyFavorability(
  db: Db,
  participant: DebateParticipant,
  delta: number,
  now: Date
): Promise<void> {
  if (delta === 0) return;
  const collection = participant.kind === "character" ? "characters" : "npps";
  const id = participant.kind === "character" ? participant.characterId : participant.nppId;
  if (!id) return;
  await db.collection(collection).updateOne({ _id: id }, [
    {
      $set: {
        favorability: {
          $min: [100, { $max: [0, { $add: [{ $ifNull: ["$favorability", 50] }, delta] }] }],
        },
        updatedAt: now,
      },
    },
  ]);
}

/**
 * Train Debate by debating: give a character participant a practice roll (winner
 * better odds) to +1 Debate, capped at STAT_MAX. NPP sides and characters without
 * an allocated stat sheet are skipped. The `$min` cap re-reads the live value so a
 * stale snapshot can't push the stat past the cap.
 */
async function applyDebatePractice(
  db: Db,
  participant: DebateParticipant,
  won: boolean,
  now: Date,
  rng: () => number
): Promise<void> {
  if (participant.kind !== "character" || !participant.characterId) return;
  const { success } = rollDebatePractice(rng, participant.stats?.debate ?? NEUTRAL_STAT, won);
  if (!success) return;
  await db
    .collection("characters")
    .updateOne({ _id: participant.characterId, stats: { $exists: true } }, [
      {
        $set: {
          "stats.debate": {
            $min: [STAT_MAX, { $add: [{ $ifNull: ["$stats.debate", NEUTRAL_STAT] }, 1] }],
          },
          updatedAt: now,
        },
      },
    ]);
}

/**
 * Resolve a session: AI-fills any non-submitted side, scores it, applies the
 * favorability swing to both sides, and marks the session resolved.
 *
 * Concurrency-safe: two independent triggers can race to resolve the same
 * session — the per-turn driver and the realtime cron both call
 * `sweepExpiredDebates`, and the submit path resolves on the final pick. So we
 * first *claim* the session with a conditional `status: awaitingStrategies →
 * resolved` write; only the caller that wins the claim (`matchedCount === 1`)
 * applies favorability + Debate XP. A loser returns the already-resolved doc
 * untouched, so effects are never double-applied. (The outcome is computed
 * before the claim — it's pure given `rng` — so the winning write is complete
 * in one update.) `rng` is injectable for tests.
 */
export async function resolveDebateSessionDoc(
  db: Db,
  session: DebateSession,
  reason: "both_submitted" | "deadline",
  now: Date,
  rng: () => number = Math.random
): Promise<DebateSession> {
  const resolved = resolveDebateSession(
    {
      stats: session.challenger.stats,
      record: session.challenger.record,
      strategies: session.challenger.strategies,
    },
    {
      stats: session.opponent.stats,
      record: session.opponent.record,
      strategies: session.opponent.strategies,
    },
    rng
  );

  const resolvedSession: DebateSession = {
    ...session,
    status: "resolved",
    resolvedAt: now,
    resolveReason: reason,
    outcome: resolved.outcome,
    challenger: { ...session.challenger, strategies: resolved.challengerStrategies },
    opponent: { ...session.opponent, strategies: resolved.opponentStrategies },
  };

  // Claim the session: only the writer that flips it out of `awaitingStrategies`
  // owns the side effects. Concurrent resolvers see matchedCount 0 and bail.
  const claim = await getDebateSessionsCollection(db).updateOne(
    { _id: session._id, status: "awaitingStrategies" },
    {
      $set: {
        status: "resolved" as const,
        resolvedAt: now,
        resolveReason: reason,
        outcome: resolved.outcome,
        "challenger.strategies": resolved.challengerStrategies,
        "opponent.strategies": resolved.opponentStrategies,
        updatedAt: now,
      },
    }
  );
  if (claim.matchedCount === 0) {
    // Lost the race — another resolver already applied the effects. Return the
    // persisted doc so callers see the actual outcome, not our recomputed one.
    const current = await getDebateSessionsCollection(db).findOne({ _id: session._id });
    return current ?? resolvedSession;
  }

  await applyFavorability(db, session.challenger, resolved.deltas.challenger, now);
  await applyFavorability(db, session.opponent, resolved.deltas.opponent, now);

  // Train Debate by debating — winner learns more than the loser.
  await applyDebatePractice(
    db,
    session.challenger,
    resolved.outcome.result === "challenger",
    now,
    rng
  );
  await applyDebatePractice(db, session.opponent, resolved.outcome.result === "opponent", now, rng);

  return resolvedSession;
}

export type SubmitStrategiesResult =
  | { ok: true; session: DebateSession; resolved: boolean }
  | { ok: false; error: string; status: number };

/**
 * Record a player's strategy picks. When both sides have submitted, resolves
 * immediately. Validates ownership, session state, and the selection.
 */
export async function submitDebateStrategies(
  db: Db,
  sessionId: ObjectId,
  characterId: ObjectId,
  strategies: DebateStrategy[],
  now: Date,
  rng: () => number = Math.random
): Promise<SubmitStrategiesResult> {
  const sessions = getDebateSessionsCollection(db);
  const session = await sessions.findOne({ _id: sessionId });
  if (!session) return { ok: false, error: "Debate not found.", status: 404 };
  if (session.status !== "awaitingStrategies") {
    return { ok: false, error: "This debate is no longer accepting strategies.", status: 409 };
  }

  const side =
    session.challenger.kind === "character" && session.challenger.characterId?.equals(characterId)
      ? "challenger"
      : session.opponent.kind === "character" && session.opponent.characterId?.equals(characterId)
        ? "opponent"
        : null;
  if (!side) return { ok: false, error: "You are not a participant in this debate.", status: 403 };
  if (session[side].mode !== "pvp") {
    return { ok: false, error: "Your side is resolved automatically.", status: 409 };
  }
  if (session[side].strategies && session[side].strategies!.length > 0) {
    return { ok: false, error: "You already submitted your strategies.", status: 409 };
  }

  // Persist this side's picks.
  session[side].strategies = strategies;
  await sessions.updateOne(
    { _id: sessionId },
    { $set: { [`${side}.strategies`]: strategies, updatedAt: now } }
  );

  // Re-read so we observe the *other* side's picks even if they submitted
  // concurrently — computing `bothReady` off our pre-write snapshot would miss a
  // simultaneous PvP submit and leave the debate to resolve only at the deadline
  // sweep (up to 12h later). The fresh doc also feeds the resolver both sides'
  // final strategies. resolveDebateSessionDoc claims atomically, so if both
  // sides resolve at once only one applies effects.
  const fresh = (await sessions.findOne({ _id: sessionId })) ?? session;
  const bothReady = !!fresh.challenger.strategies?.length && !!fresh.opponent.strategies?.length;
  if (bothReady && fresh.status === "awaitingStrategies") {
    const resolvedSession = await resolveDebateSessionDoc(db, fresh, "both_submitted", now, rng);
    return { ok: true, session: resolvedSession, resolved: true };
  }
  return { ok: true, session: fresh, resolved: fresh.status === "resolved" };
}

/**
 * Void any still-pending debate session tied to an election that just
 * concluded (primary loser eliminated, or the general/primary election
 * itself resolved). Unlike `resolveDebateSessionDoc`, this applies no
 * favorability/XP effects — the debate no longer corresponds to a live
 * race, so its outcome shouldn't swing anything. Reuses the already-modeled
 * `"expired"` status (previously dead code) rather than inventing a new one.
 */
export async function voidDebateSessionsForElection(
  db: Db,
  electionId: ObjectId,
  now: Date
): Promise<number> {
  const result = await getDebateSessionsCollection(db).updateMany(
    { electionId, status: "awaitingStrategies" },
    {
      $set: {
        status: "expired",
        resolvedAt: now,
        resolveReason: "election_ended",
        updatedAt: now,
      },
    }
  );
  return result.modifiedCount;
}

/** Resolve every awaiting session past its deadline (turn/cron sweep). */
export async function sweepExpiredDebates(
  db: Db,
  now: Date,
  rng: () => number = Math.random
): Promise<number> {
  const sessions = getDebateSessionsCollection(db);
  const expired = await sessions
    .find({ status: "awaitingStrategies", deadlineRealtimeMs: { $lte: now.getTime() } })
    .toArray();
  for (const session of expired) {
    await resolveDebateSessionDoc(db, session, "deadline", now, rng);
  }
  return expired.length;
}
