import type { Election, GameState } from "@/lib/db/types";
import { DE_WAHLKREIS_SEATS } from "@/lib/constants";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { loadApportionment } from "@/lib/elections/apportionment";
import { getSeatIdFromElection } from "@/lib/seats";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import {
  cycleAnchorContextFromGameState,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { generateLandeslistenForCycle } from "@/lib/elections/germanyLandesliste";

/**
 * Convert a prior endTime to a LARP turn number, anchored on `nowRef`'s
 * currentTurn. 1 turn = 1 real hour.
 */
function endTimeToLarpTurn(endTime: Date, nowRef: Date, currentTurn: number): number {
  const MS_PER_HOUR = 3_600_000;
  const turnsAgo = Math.round((nowRef.getTime() - new Date(endTime).getTime()) / MS_PER_HOUR);
  return currentTurn - turnsAgo;
}

type Db = Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>;

async function getCurrentTurnAndCtx(
  db: Db
): Promise<{ currentTurn: number; ctx: CycleAnchorContext }> {
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  return {
    currentTurn: gs?.currentTurn ?? 1,
    ctx: cycleAnchorContextFromGameState(gs),
  };
}

/**
 * True while the pre-iteration founding phase is still running.
 *
 * These spawners are called from `generalResolution` the instant a race
 * resolves — they are NOT part of the `electionCoverageAndSuccession` battery
 * that `turnPhaseRegistry` suppresses during the founding phase. Without this
 * guard, the moment a founding race resolved, `pickNextCanonicalCycle` saw
 * `preIterationActive` still set and handed back ANOTHER cycle 0, so:
 *
 *   - `detectPreIterationComplete` (which ends the phase only when no
 *     active/upcoming cycle-0 race is left) never fired — the founding phase
 *     ran forever, the calendar stayed pinned to the era's starting year, and
 *     the historical stagger never re-emerged; and
 *   - every subsequent lower-chamber election was another 48-turn "founding"
 *     sprint instead of that body's real multi-year term.
 *
 * Measured on a 1953-default founding sim: at turn 49 the 603 founding races
 * resolved and immediately re-spawned 66 fresh cycle-0 races (US house ×48,
 * UK commons ×12, NG house ×6), leaving `preIteration.active` true at turn 50.
 *
 * Skipping the spawn here is correct rather than merely safe: the suppressed
 * `ensurePerpetualElections` battery spawns the real cycle 1 on the very next
 * turn, by which point `detectPreIterationComplete` has stamped
 * `preIterationTurns`, so the new cycle lands on its offset historical anchor.
 * Spawning here instead would anchor it against a not-yet-written offset.
 */
function foundingPhaseActive(ctx: CycleAnchorContext): boolean {
  return ctx.preIterationActive === true;
}

/**
 * Spawn the next House election on the canonical LARP schedule. Called from
 * `generalResolution` immediately after a House cycle resolves — canonical
 * anchoring keeps admin-accelerated cycles from dragging the calendar.
 *
 * In the normal cadence (cycle N ended exactly at its canonical endTurn), the
 * new cycle's canonical startTurn ≤ currentTurn and the election spawns as
 * "active" with startTime just in the past. When admin fast-forwarded cycle N
 * to resolve early, the new cycle's canonical startTurn is in the future and
 * the election spawns as "upcoming" — advanceElectionTimers will flip it to
 * "active" once the canonical window opens.
 */
export async function spawnHouseElection(db: Db, fromElection: Election, now: Date): Promise<void> {
  const existing = await db.collection<Election>("elections").findOne({
    electionType: "house",
    state: fromElection.state,
    status: { $in: ["active", "upcoming"] },
  });
  if (existing) return;

  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  // See foundingPhaseActive: the founding cycle re-spawn loop lives here.
  if (foundingPhaseActive(ctx)) return;
  const spawn = pickNextCanonicalCycle({
    electionType: "house",
    prevCycle: fromElection.cycle ?? 0,
    currentTurn,
    ctx,
  });
  if (!spawn) {
    console.warn(
      `[spawnHouseElection] no canonical cycle within gate for ${fromElection.state} after cycle ${fromElection.cycle}`
    );
    return;
  }

  const canonical = DEFAULT_DURATIONS.house;
  const startTime = turnToWallClock(spawn.startTurn, now, currentTurn);
  const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
  const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
  const status: "active" | "upcoming" = spawn.startTurn <= currentTurn ? "active" : "upcoming";

  // Live (census-updated) House apportionment; equals the preset seed until a
  // decennial census reapportions (P1d-2).
  const { houseSeats: liveHouseSeats } = await loadApportionment(db, ctx.preset);

  const newElection: Omit<Election, "_id"> = {
    state: fromElection.state,
    countryId: fromElection.countryId,
    electionType: "house",
    cycle: spawn.cycle,
    electionYear: electionToLarpYear("house", spawn.cycle, undefined, undefined, ctx),
    seatId: getSeatIdFromElection({
      countryId: fromElection.countryId,
      electionType: "house",
      state: fromElection.state!,
    }),
    status,
    totalSeats: fromElection.totalSeats ?? liveHouseSeats[fromElection.state!] ?? 1,
    startTime,
    primaryEndTime,
    endTime,
    startTurn: spawn.startTurn,
    primaryEndTurn: spawn.primaryEndTurn,
    endTurn: spawn.endTurn,
    durationHours: canonical.durationHours,
    primaryDurationHours: canonical.primaryDurationHours,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.collection<Election>("elections").insertOne(newElection as Election);
  console.log(
    `[Turn] House election spawned for ${fromElection.state} cycle ${spawn.cycle} status=${status} — id ${inserted.insertedId}`
  );
}

/**
 * Spawn the next Commons election on the canonical LARP schedule. Called
 * from `generalResolution` when a regular or snap Commons cycle resolves.
 *
 * When the resolving election is a snap (`snap_commons`), its endTurn
 * becomes the anchor for the next regular cycle via
 * `pickNextCanonicalCycle(..., priorEndTurn)` — matching the snap-shift
 * rule in docs/design/snap-elections.md. Regular-to-regular transitions
 * use pure canonical LARP, so admin-accelerated prior cycles do NOT drag
 * the calendar forward.
 */
export async function spawnCommonsElection(
  db: Db,
  fromElection: Election,
  now: Date
): Promise<void> {
  const existing = await db.collection<Election>("elections").findOne({
    electionType: "commons",
    state: fromElection.state,
    status: { $in: ["active", "upcoming"] },
  });
  if (existing) return;

  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  // See foundingPhaseActive: the founding cycle re-spawn loop lives here.
  if (foundingPhaseActive(ctx)) return;
  const priorEndTurn =
    fromElection.electionType === "snap_commons" && fromElection.endTime
      ? endTimeToLarpTurn(fromElection.endTime, now, currentTurn)
      : null;

  const spawn = pickNextCanonicalCycle({
    electionType: "commons",
    prevCycle: fromElection.cycle ?? 0,
    currentTurn,
    priorEndTurn,
    ctx,
  });
  if (!spawn) {
    console.warn(
      `[spawnCommonsElection] no canonical cycle within gate for ${fromElection.state} after cycle ${fromElection.cycle}`
    );
    return;
  }

  const canonical = DEFAULT_DURATIONS.commons;
  // Open the primary immediately: Commons' 5-year cycle (240 turns) far exceeds
  // its 48h `durationHours`, so the canonical `startTurn` would otherwise land a
  // long "Opens in X turns" dead zone after the prior general ends. Mirror
  // `spawnBundestagElection` — the primary fills the gap while `primaryEndTurn` /
  // `endTurn` stay canonical so the general still lands on its real-world year.
  const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
  const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
  const status: "active" | "upcoming" = "active";

  const newElection: Omit<Election, "_id"> = {
    countryId: "UK",
    state: fromElection.state,
    electionType: "commons",
    cycle: spawn.cycle,
    electionYear: electionToLarpYear("commons", spawn.cycle, undefined, undefined, ctx),
    seatId: getSeatIdFromElection({
      countryId: "UK",
      electionType: "commons",
      state: fromElection.state!,
    }),
    status,
    // Prefer the era map over the prior race's totalSeats — earlier cycles may
    // still carry the modern 650-seat counts under a 1953 world (#1058).
    totalSeats: getUkCommonsSeats(ctx.preset)[fromElection.state!] ?? fromElection.totalSeats ?? 1,
    startTime: now,
    primaryEndTime,
    endTime,
    startTurn: currentTurn,
    primaryEndTurn: spawn.primaryEndTurn,
    endTurn: spawn.endTurn,
    durationHours: canonical.durationHours,
    primaryDurationHours: canonical.primaryDurationHours,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.collection<Election>("elections").insertOne(newElection as Election);
  console.log(
    `[Turn] Commons election spawned for ${fromElection.state} cycle ${spawn.cycle} status=${status} — id ${inserted.insertedId}`
  );
}

/**
 * Spawn the next Bundestag election for a Bundesland on the canonical LARP
 * schedule. Called from `generalResolution` after a per-Land Bundestag cycle
 * resolves. Mirrors `spawnCommonsElection`: one multi-seat Election doc per
 * Land, with `totalSeats` set to the Land's Wahlkreise count. The AMS list-
 * tier reconciliation (germanyAMS.ts) runs once all 16 Land elections complete.
 */
export async function spawnBundestagElection(
  db: Db,
  fromElection: Election,
  now: Date
): Promise<void> {
  const existing = await db.collection<Election>("elections").findOne({
    electionType: "bundestag",
    state: fromElection.state,
    status: { $in: ["active", "upcoming"] },
  });
  if (existing) return;

  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  // See foundingPhaseActive: the founding cycle re-spawn loop lives here.
  if (foundingPhaseActive(ctx)) return;
  const spawn = pickNextCanonicalCycle({
    electionType: "bundestag",
    prevCycle: fromElection.cycle ?? 0,
    currentTurn,
    ctx,
  });
  if (!spawn) {
    console.warn(
      `[spawnBundestagElection] no canonical cycle within gate for ${fromElection.state} after cycle ${fromElection.cycle}`
    );
    return;
  }

  const canonical = DEFAULT_DURATIONS.bundestag ?? DEFAULT_DURATIONS.commons;
  const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
  const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

  const newElection: Omit<Election, "_id"> = {
    countryId: "DE",
    state: fromElection.state,
    electionType: "bundestag",
    cycle: spawn.cycle,
    electionYear: electionToLarpYear("bundestag", spawn.cycle, undefined, undefined, ctx),
    seatId: getSeatIdFromElection({
      countryId: "DE",
      electionType: "bundestag",
      state: fromElection.state!,
    }),
    status: "active",
    totalSeats: fromElection.totalSeats ?? DE_WAHLKREIS_SEATS[fromElection.state!] ?? 1,
    startTime: now,
    primaryEndTime,
    endTime,
    startTurn: currentTurn,
    primaryEndTurn: spawn.primaryEndTurn,
    endTurn: spawn.endTurn,
    durationHours: canonical.durationHours,
    primaryDurationHours: canonical.primaryDurationHours,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.collection<Election>("elections").insertOne(newElection as Election);
  console.log(
    `[Turn] Bundestag election spawned for ${fromElection.state} cycle ${spawn.cycle} status=${newElection.status} - id ${inserted.insertedId}`
  );

  // Seed Landeslisten for the new cycle so chairs have an edit window before the
  // AMS list tier consumes them. Idempotent + preserves existing chair edits.
  await generateLandeslistenForCycle(db, spawn.cycle);
}
