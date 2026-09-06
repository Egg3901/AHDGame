import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { JP_SHUGIIN_SEATS, JP_SANGIIN_SEATS } from "@/lib/constants/states";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats";
import { snapAnchorEndTime } from "@/lib/elections/snapShift";
import {
  endTimeToLarpTurn,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  justResolvedInSameTurn,
  sendBatchedElectionAnnouncements,
} from "../engine";
import { ensureRegionalGovernorElections } from "../shared";

/**
 * Ensure every JP region has an active or upcoming Shugiin election.
 *
 * Spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. When the admin fast-forwards a regular
 * cycle via "Modify Timers", the next regular stays on calendar
 * (endTurn = anchors.jpShugiin + (N - 1) x dur.durationHours). Snap elections still shift the schedule
 * for the immediate post-snap regular — when prev is a `snap_shugiin`, the
 * shared helper receives `priorEndTurn = snap.endTurn` and the new cycle
 * anchors to `snap.endTurn + 192` per docs/design/snap-elections.md.
 * Subsequent regulars past the first post-snap cycle fall back to canonical
 * LARP, preserving the calendar against later admin acceleration.
 *
 * 24h-primary / 24h-general gate: if currentTurn has eaten too deep into the
 * next canonical window, the spawner walks forward to the following cycle
 * rather than producing a stub race.
 */
export async function ensureJPElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const jpRegions = await db
    .collection<State>("states")
    .find({ countryId: "JP" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = jpRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  // Active/upcoming regular or snap Shugiin elections suppress spawning.
  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "JP",
      electionType: { $in: ["shugiin", "snap_shugiin"] },
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveShugiin = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      electionType: { $in: ["shugiin", "snap_shugiin"] },
      countryId: "JP",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS.shugiin.durationHours;
  const genDur = getGeneralWindow("shugiin");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveShugiin.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Snap shift: only when prev is a snap the country called itself does its
    // endTurn anchor the next regular's LARP schedule. See `snapAnchorEndTime`.
    const snapAnchor = snapAnchorEndTime(prev, "snap_shugiin");
    const priorEndTurn = snapAnchor ? endTimeToLarpTurn(snapAnchor, now, currentTurn) : null;

    const spawn = pickNextCanonicalCycle({
      electionType: "shugiin",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn,
      ctx,
    });
    if (!spawn) continue;

    const startTime = turnToWallClock(spawn.startTurn, now, currentTurn);
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
    const status: "active" | "upcoming" = spawn.startTurn <= currentTurn ? "active" : "upcoming";

    toInsert.push({
      countryId: "JP",
      electionType: "shugiin",
      state: regionId,
      seatId: getSeatIdFromElection({
        countryId: "JP",
        electionType: "shugiin",
        state: regionId,
      }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("shugiin", spawn.cycle, undefined, undefined, ctx),
      status,
      totalSeats: prev?.totalSeats ?? JP_SHUGIIN_SEATS[regionId] ?? 1,
      startTime,
      primaryEndTime,
      endTime,
      startTurn: spawn.startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur,
      primaryDurationHours: dur - genDur,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  // Guard against duplicates
  const orFilters = toInsert.map((e) => ({
    electionType: "shugiin" as const,
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
      `[Turn] ensureJPElections: spawned ${toActuallyInsert.length} missing Shugiin election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── Japan: Sangiin (House of Councillors) Half-Elections ────────────────────

/**
 * Ensure Sangiin elections exist for JP regions in BOTH classes.
 * Half of the 248 seats are contested every 3 game years (144 turns) per class;
 * each class runs on its own 6-year (288-turn) cycle anchored to its real-world
 * election date (JP_SANGIIN_CYCLE1_END_TURN). Each class is processed
 * independently.
 *
 * Spawned cycles anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. A new cycle's `endTime` is derived from the
 * real-world Sangiin election year, not from `now + 144h`. If the admin fast-
 * forwards a prior cycle, the next cycle is not pulled along with it — it
 * stays on the calendar. When the canonical next-cycle window is already past
 * (or would leave <24h primary / <24h general remaining from `currentTurn`),
 * the spawner skips forward to the following Sangiin half-election.
 *
 * Status is set relative to the canonical startTurn:
 *   • startTurn > currentTurn → "upcoming" (startTime in the future)
 *   • startTurn ≤ currentTurn → "active"  (startTime anchored at startTurn,
 *     which may be in the past — primary/general windows still align to the
 *     canonical endTurn).
 *
 * `advanceElectionTimers` flips "upcoming" → "active" once startTime ≤ now.
 */
export async function ensureJPCouncillorElections(now: Date, classOverride?: 1 | 2): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  // Process both classes unless a specific override is given
  const classesToProcess: (1 | 2)[] = classOverride ? [classOverride] : [1, 2];

  // Find ALL JP regions — each region participates in both classes (half seats per class)
  const jpRegions = await db
    .collection<State>("states")
    .find({ countryId: "JP" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = jpRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  const dur = DEFAULT_DURATIONS.sangiin.durationHours;
  const genDur = getGeneralWindow("sangiin");

  for (const chamberClass of classesToProcess) {
    // Check for active/upcoming Sangiin elections for this class in any region
    const liveElections = await db
      .collection<Election>("elections")
      .find({
        electionType: "sangiin",
        countryId: "JP",
        chamberClass,
        state: { $in: regionIds },
        status: { $in: ["active", "upcoming"] },
      })
      .toArray();
    const liveSangiin = new Set(liveElections.map((e) => e.state));

    const completedElections = await db
      .collection<Election>("elections")
      .find({
        electionType: "sangiin",
        countryId: "JP",
        chamberClass,
        state: { $in: regionIds },
        status: { $in: ["completed", "resolved"] },
      })
      .sort({ updatedAt: -1 })
      .toArray();

    function lastCompleted(regionId: string): Election | undefined {
      return completedElections.find((e) => e.state === regionId);
    }

    const toInsert: Omit<Election, "_id">[] = [];

    for (const regionId of regionIds) {
      if (liveSangiin.has(regionId)) continue;

      const prev = lastCompleted(regionId);
      if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
      const prevCycle = prev?.cycle ?? 0;

      const spawn = pickNextCanonicalCycle({
        electionType: "sangiin",
        chamberClass,
        prevCycle,
        currentTurn,
        ctx,
      });
      if (!spawn) continue; // exhausted the skip bound — don't spawn a malformed cycle

      // Open the primary immediately: Sangiin's 6-year per-class cycle (288
      // turns) far exceeds its 144h `durationHours`, so the canonical
      // `startTurn` would otherwise leave a long "Opens in X turns" dead zone
      // after the prior half-election. Mirror DE — `primaryEndTurn` / `endTurn`
      // stay canonical so the general still lands on its real-world year.
      const startTurn = currentTurn;
      const startTime = now;
      const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
      const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
      const status: "active" | "upcoming" = "active";

      // Each class contests half the region's total Sangiin seats
      const totalRegionSeats = JP_SANGIIN_SEATS[regionId] ?? 2;
      const classSeats = Math.ceil(totalRegionSeats / 2);

      toInsert.push({
        countryId: "JP",
        electionType: "sangiin",
        state: regionId,
        chamberClass,
        seatId: getSeatIdFromElection({
          countryId: "JP",
          electionType: "sangiin",
          state: regionId,
          chamberClass,
        }),
        cycle: spawn.cycle,
        electionYear: electionToLarpYear("sangiin", spawn.cycle, undefined, chamberClass, ctx),
        status,
        totalSeats: prev?.totalSeats ?? classSeats,
        startTime,
        primaryEndTime,
        endTime,
        startTurn,
        primaryEndTurn: spawn.primaryEndTurn,
        endTurn: spawn.endTurn,
        durationHours: dur,
        primaryDurationHours: dur - genDur,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (toInsert.length === 0) continue;

    // Guard against duplicates — must match both state AND chamberClass
    const orFilters = toInsert.map((e) => ({
      electionType: "sangiin" as const,
      chamberClass,
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
        `[Turn] ensureJPCouncillorElections: spawned ${toActuallyInsert.length} Sangiin election(s) (Class ${chamberClass})`
      );
      sendBatchedElectionAnnouncements(toActuallyInsert, now);
    }
  }
}

// ─── Japan: Regional Council (prefectural assembly) ──────────────────────────

/**
 * Ensure every JP region has an active or upcoming regionalCouncil election.
 *
 * Synchronized with the Shugiin cycle — the JP analogue of the UK pattern
 * (Regional Council tracks Commons). When a live Shugiin race exists for the
 * region, the regional council mirrors its timestamps, cycle, and electionYear
 * exactly so both resolve together on a JP-correct calendar. This sidesteps the
 * UK-anchored `regionalCouncil` branch in canonicalCycle.ts (which would put JP
 * councils on the UK GE calendar). When no live Shugiin exists to mirror, falls
 * back to the Shugiin canonical schedule.
 *
 * Ordering note: this runs concurrently with ensureJPElections (the country
 * election phases share a Promise.all), so a Shugiin race created on the same
 * turn may not be visible yet. That's fine — in steady state and on the
 * first-deploy heal a live Shugiin from prior turns is present (mirror path),
 * and at clean roll-over/bootstrap the fallback recomputes the identical
 * Shugiin canonical cycle, so both land on the same schedule either way.
 */
export async function ensureJPRegionalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const jpRegions = await db
    .collection<State>("states")
    .find({ countryId: "JP" }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const regions = jpRegions.map((r) => ({ id: r._id as string, seats: r.stateSenateSeats }));
  if (regions.length === 0) return;

  // Country-scoped: UK's spawner relies on disjoint region IDs and is not
  // country-scoped; JP's is scoped to avoid cross-country contamination.
  const liveElections = await db
    .collection<Election>("elections")
    .find({
      electionType: "regionalCouncil",
      countryId: "JP",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveCouncils = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      electionType: "regionalCouncil",
      countryId: "JP",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS.regionalCouncil.durationHours;
  const genDur = getGeneralWindow("regionalCouncil");

  // Sync source: live Shugiin (regular or snap) per region.
  const liveShugiinElections = await db
    .collection<Election>("elections")
    .find({
      electionType: { $in: ["shugiin", "snap_shugiin"] },
      countryId: "JP",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const shugiinByRegion = new Map(liveShugiinElections.map((e) => [e.state, e]));

  const toInsert: Omit<Election, "_id">[] = [];

  for (const region of regions) {
    const regionId = region.id;
    if (liveCouncils.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const totalSeats = prev?.totalSeats ?? region.seats ?? 1;

    // Mirror path: copy the live Shugiin's schedule, cycle, and year so both
    // races resolve together on a JP-correct calendar.
    const shugiin = shugiinByRegion.get(regionId);
    if (shugiin?.startTime && shugiin?.primaryEndTime && shugiin?.endTime) {
      toInsert.push({
        countryId: "JP",
        electionType: "regionalCouncil",
        state: regionId,
        seatId: getSeatIdFromElection({
          countryId: "JP",
          electionType: "regionalCouncil",
          state: regionId,
        }),
        cycle: shugiin.cycle,
        electionYear: shugiin.electionYear,
        status: shugiin.status as "active" | "upcoming",
        totalSeats,
        startTime: shugiin.startTime,
        primaryEndTime: shugiin.primaryEndTime,
        endTime: shugiin.endTime,
        startTurn: shugiin.startTurn,
        primaryEndTurn: shugiin.primaryEndTurn,
        endTurn: shugiin.endTurn,
        durationHours: dur,
        primaryDurationHours: dur - genDur,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    // Fallback: no live Shugiin to mirror — spawn on the Shugiin canonical
    // schedule. No open-primary-immediately: Shugiin's canonical startTurn
    // already equals the prior endTurn, so there is no dead zone to fill.
    const spawn = pickNextCanonicalCycle({
      electionType: "shugiin",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      ctx,
    });
    if (!spawn) continue;

    const startTime = turnToWallClock(spawn.startTurn, now, currentTurn);
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
    const status: "active" | "upcoming" = spawn.startTurn <= currentTurn ? "active" : "upcoming";

    toInsert.push({
      countryId: "JP",
      electionType: "regionalCouncil",
      state: regionId,
      seatId: getSeatIdFromElection({
        countryId: "JP",
        electionType: "regionalCouncil",
        state: regionId,
      }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("shugiin", spawn.cycle, undefined, undefined, ctx),
      status,
      totalSeats,
      startTime,
      primaryEndTime,
      endTime,
      startTurn: spawn.startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur,
      primaryDurationHours: dur - genDur,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  // Guard against duplicates (same safety as ensureUKRegionalCouncilElections).
  const orFilters = toInsert.map((e) => ({
    electionType: "regionalCouncil" as const,
    countryId: "JP" as const,
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
      `[Turn] ensureJPRegionalCouncilElections: spawned ${toActuallyInsert.length} missing Regional Council election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Spawn perpetual governor elections for all 8 JP regions on a
 * preset-anchored 4-year cycle.
 */
export async function ensureJPGovernorElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("JP", now);
}
