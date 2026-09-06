import { type AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats";
import {
  getUKRegionalCouncilCycle1EndTurn,
  getUKRegionalCouncilElectionYear,
} from "@/lib/elections/ukRegionalCouncilStagger";
import { snapAnchorEndTime } from "@/lib/elections/snapShift";
import {
  endTimeToLarpTurn,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  justResolvedInSameTurn,
  sendBatchedElectionAnnouncements,
} from "../engine";
import { UK_GOVERNOR_REGIONS, ensureRegionalGovernorElections } from "../shared";

/**
 * Ensure every UK region has an active/upcoming Commons election.
 *
 * Spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. When the admin fast-forwards a regular
 * cycle via the "Modify Timers" PATCH, the next regular stays on calendar
 * (endTurn = anchors.ukCommons + (N - 1) x UK_COMMONS_CYCLE_PERIOD_HOURS). Snap elections still shift the schedule
 * for the immediate post-snap regular — the shared helper accepts
 * `priorEndTurn = snap.endTurn`, giving `endTurn = snap.endTurn + 240` per
 * docs/design/snap-elections.md. Subsequent regulars (past the first post-snap
 * cycle) fall back to canonical LARP, preserving the calendar against any
 * later admin acceleration.
 *
 * 24h-primary / 24h-general gate: if currentTurn has eaten too deep into the
 * next canonical window, the spawner walks forward to the following cycle
 * rather than producing a stub race.
 *
 * Called from turnSystem after ensurePerpetualElections.
 */
export async function ensureUKElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  const commonsSeatsByRegion = getUkCommonsSeats(ctx.preset);

  const ukRegions = await db
    .collection<State>("states")
    .find({ countryId: "UK" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ukRegions.map((r) => r._id as string);

  if (regionIds.length === 0) return;

  // Include snap_commons so a live snap suppresses spawning a regular, and a
  // resolved snap contributes to cycle-period / cycle-number calculations.
  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "UK",
      electionType: { $in: ["commons", "snap_commons"] },
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();

  // Heal live races that still carry the modern 650-seat map under a 1953
  // world (or any other era mismatch). Same pattern as NG houseDistricts
  // force-heal — without this, projections keep reading the wrong totalSeats
  // until the next cycle, even after allocateSeats is era-aware (#1058).
  const seatHealOps = liveElections.flatMap((e) => {
    const expected = e.state ? commonsSeatsByRegion[e.state] : undefined;
    if (expected == null || e.totalSeats === expected) return [];
    return [
      {
        updateOne: {
          filter: { _id: e._id },
          update: { $set: { totalSeats: expected, updatedAt: now } },
        },
      },
    ];
  });
  if (seatHealOps.length > 0) {
    await db.collection<Election>("elections").bulkWrite(seatHealOps);
    console.log(
      `[Turn] ensureUKElections: healed totalSeats on ${seatHealOps.length} live Commons race(s)`
    );
  }

  const liveCommons = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "UK",
      electionType: { $in: ["commons", "snap_commons"] },
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS.commons.durationHours;
  const genDur = getGeneralWindow("commons");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveCommons.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Snap shift: only the immediate post-snap regular inherits the snap's
    // endTurn as its anchor, and only when the country called the snap itself.
    // See `snapAnchorEndTime` for why a regular and an IMPOSED snap both yield
    // null here.
    const snapAnchor = snapAnchorEndTime(prev, "snap_commons");
    const priorEndTurn = snapAnchor ? endTimeToLarpTurn(snapAnchor, now, currentTurn) : null;

    const spawn = pickNextCanonicalCycle({
      electionType: "commons",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn,
      ctx,
    });
    if (!spawn) continue;

    // Open the primary immediately: UK Commons' 5-year cycle (240 turns) far
    // exceeds its 48h `durationHours`, so the canonical `startTurn` would
    // otherwise land a long "Opens in X turns" dead zone after the prior
    // general ends. Mirror DE — the primary fills the gap; `primaryEndTurn` /
    // `endTurn` stay canonical so the general still lands on its real-world year.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
    const status: "active" | "upcoming" = "active";

    toInsert.push({
      countryId: "UK",
      electionType: "commons",
      state: regionId,
      seatId: getSeatIdFromElection({ countryId: "UK", electionType: "commons", state: regionId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear("commons", spawn.cycle, undefined, undefined, ctx),
      status,
      totalSeats: commonsSeatsByRegion[regionId] ?? prev?.totalSeats ?? 1,
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

  if (toInsert.length === 0) return;

  // Guard against duplicates (same safety as ensurePerpetualElections)
  const orFilters = toInsert.map((e) => ({
    electionType: "commons" as const,
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
      `[Turn] ensureUKElections: spawned ${toActuallyInsert.length} missing Commons election(s)`
    );

    // Discord: notify about newly opened UK elections (batched by type)
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Ensure every UK region has an active or upcoming regionalCouncil election.
 *
 * Councils are split across five annual cohorts, each retaining a five-year
 * term. The transition/founding cycle 0 is synchronized; every later cycle
 * uses the region's cohort anchor. Cohort 5 lands with the next Commons
 * election while cohorts 1-4 form the annual midterms.
 */
export async function ensureUKRegionalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  // Self-heal stale stateSenateSeats (e.g. 1991 seed drift) so legislature pages
  // and elections agree on regional council chamber sizes.
  const seatSyncOps: AnyBulkWriteOperation<State>[] = Object.entries(UK_REGIONAL_COUNCIL_SEATS).map(
    ([regionId, seats]) => ({
      updateOne: {
        filter: { _id: regionId, countryId: "UK", stateSenateSeats: { $ne: seats } },
        update: { $set: { stateSenateSeats: seats } },
      },
    })
  );
  if (seatSyncOps.length > 0) {
    await db.collection<State>("states").bulkWrite(seatSyncOps, { ordered: false });
  }

  const ukRegions = await db
    .collection<State>("states")
    .find({ countryId: "UK" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ukRegions.map((r) => r._id as string);

  if (regionIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({ electionType: "regionalCouncil", status: { $in: ["active", "upcoming"] } })
    .toArray();
  const liveCouncils = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({ electionType: "regionalCouncil", status: { $in: ["completed", "resolved"] } })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS.regionalCouncil.durationHours;
  const genDur = getGeneralWindow("regionalCouncil");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveCouncils.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Spawn independently on the region's annual-cohort anchor.
    const spawn = pickNextCanonicalCycle({
      electionType: "regionalCouncil",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      ctx,
      customCycle1EndTurn: getUKRegionalCouncilCycle1EndTurn(regionId, ctx),
    });
    if (!spawn) continue;

    // Open the primary immediately. The general close remains on the cohort's
    // canonical annual slot while filing uses the otherwise idle interval.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
    const status: "active" | "upcoming" = "active";

    toInsert.push({
      countryId: "UK",
      electionType: "regionalCouncil",
      state: regionId,
      seatId: getSeatIdFromElection({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: regionId,
      }),
      cycle: spawn.cycle,
      electionYear: getUKRegionalCouncilElectionYear(regionId, spawn.cycle, ctx),
      status,
      totalSeats: prev?.totalSeats ?? UK_REGIONAL_COUNCIL_SEATS[regionId] ?? 1,
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

  if (toInsert.length === 0) return;

  // Guard against duplicates (same safety as ensureUKElections)
  const orFilters = toInsert.map((e) => ({
    electionType: "regionalCouncil" as const,
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
      `[Turn] ensureUKRegionalCouncilElections: spawned ${toActuallyInsert.length} missing Regional Council election(s)`
    );

    // Discord: notify about newly opened UK elections (batched by type)
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── Japan: Shugiin (House of Representatives) ──────────────────────────────

/**
 * Spawn perpetual governor elections for UK devolved-executive regions:
 *   - First Minister of Scotland / Wales / Northern Ireland (SCO/WAL/NIR)
 *   - Mayor of London (LON)
 *
 * 4-year cycle anchored to the preset's `governorStateSenate` year.
 * English non-London regions have no devolved executive and are skipped.
 */
export async function ensureUKGovernorElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("UK", now, UK_GOVERNOR_REGIONS);
}
