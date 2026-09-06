import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { DE_WAHLKREIS_SEATS } from "@/lib/constants/states";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats";
import { generateLandeslistenForCycle } from "@/lib/elections/germanyLandesliste";
import { snapAnchorEndTime } from "@/lib/elections/snapShift";
import {
  endTimeToLarpTurn,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  sendBatchedElectionAnnouncements,
} from "../engine";

/**
 * Ensure a live Bundestag election exists for every Bundesland. Mirrors
 * `ensureUKElections` — one multi-seat Election doc per Land (totalSeats =
 * that Land's Wahlkreise count). The AMS list-tier reconciliation in
 * germanyAMS.ts runs after all 16 Land elections complete per cycle.
 */
export async function ensureDEElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const deLaender = await db
    .collection<State>("states")
    .find({ countryId: "DE" }, { projection: { _id: 1 } })
    .toArray();
  const landIds = deLaender.map((r) => r._id as string);
  if (landIds.length === 0) return;

  // Include snap_bundestag so a live snap suppresses spawning a regular, and a
  // resolved snap contributes to cycle-period / cycle-number calculations.
  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: { $in: ["bundestag", "snap_bundestag"] },
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveBundestag = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: { $in: ["bundestag", "snap_bundestag"] },
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(landId: string): Election | undefined {
    return completedElections.find((e) => e.state === landId);
  }

  const dur = DEFAULT_DURATIONS.bundestag.durationHours;
  const genDur = getGeneralWindow("bundestag");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const landId of landIds) {
    if (liveBundestag.has(landId)) continue;

    const prev = lastCompleted(landId);

    // Snap shift: only the immediate post-snap regular inherits the snap's
    // endTurn as its anchor. Regular-to-regular transitions use pure canonical
    // LARP to keep admin edits from dragging the calendar.
    const snapAnchor = snapAnchorEndTime(prev, "snap_bundestag");
    const priorEndTurn = snapAnchor ? endTimeToLarpTurn(snapAnchor, now, currentTurn) : null;

    const spawn = pickNextCanonicalCycle({
      electionType: "bundestag",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn,
      ctx,
    });
    if (!spawn) continue;

    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId: "DE",
      electionType: "bundestag",
      state: landId,
      seatId: getSeatIdFromElection({
        countryId: "DE",
        electionType: "bundestag",
        state: landId,
      }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("bundestag", spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? DE_WAHLKREIS_SEATS[landId] ?? 1,
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

  // Guard against duplicates (same safety as ensureUKElections).
  const orFilters = toInsert.map((e) => ({
    electionType: "bundestag" as const,
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
      `[Turn] ensureDEElections: spawned ${toActuallyInsert.length} missing Bundestag election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);

    // Seed Landeslisten for each newly-spawned cycle so chairs have an edit
    // window before the AMS list tier consumes them. Idempotent + preserves edits.
    const cyclesSpawned = [...new Set(toActuallyInsert.map((e) => e.cycle))];
    for (const c of cyclesSpawned) {
      await generateLandeslistenForCycle(db, c);
    }
  }
}

// Re-export DE election spawners for countryPhases.ts barrel-import consistency.

// ─── Shared regional multi-seat delegate spawner ─────────────────────────────
