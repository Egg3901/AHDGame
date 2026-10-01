import { yearOfTurn } from "@/lib/utils/gameDate";
import { readUKDevolutionState } from "../devolution/service";
import { executiveCycleAnchor } from "../devolution/rules";
import { withCampaignRules } from "@/lib/campaignTargeting/rules";
import { type AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election, ElectionStatus, State } from "@/lib/db/types";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import { getSeatIdFromElection } from "@/lib/seats";
import {
  getUKRegionalCouncilCycle1EndTurn,
  getUKRegionalCouncilElectionYear,
} from "@/lib/elections/ukRegionalCouncilStagger";
import { snapElectionResolutionYear } from "@/lib/turn/rules/snapElection";
import { planNextLowerChamberCycle, shiftedAnchorTurn } from "@/lib/elections/snapShift";
import {
  endTimeToLarpTurn,
  getCurrentTurnAndCtx,
  getGeneralWindow,
  justResolvedInSameTurn,
  sendBatchedElectionAnnouncements,
} from "@/lib/turn/perpetualElections/engine";
import {
  UK_GOVERNOR_REGIONS,
  ensureRegionalGovernorElections,
} from "@/lib/turn/perpetualElections/shared";

/**
 * Ensure every UK region has an active/upcoming Commons election.
 *
 * Spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. When the admin fast-forwards a regular
 * cycle via the "Modify Timers" PATCH, the next regular stays on calendar
 * (endTurn = anchors.ukCommons + (N - 1) x UK_COMMONS_CYCLE_PERIOD_HOURS). A snap
 * election resets the term clock: the post-snap regular ends at
 * `snap.endTurn + 240`, and every later regular keeps counting from that
 * shifted schedule (`shiftedScheduleEndTurn + 240`) until another snap moves
 * it again. The stamp is the scheduled turn, so admin acceleration still
 * cannot drag the calendar. See `planNextLowerChamberCycle`.
 *
 * 24h-primary / 24h-general gate: if currentTurn has eaten too deep into the
 * next canonical window, the spawner walks forward to the following cycle
 * rather than producing a stub race.
 *
 * Called from turnSystem after ensurePerpetualElections.
 */
export async function ensureUKElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  const { currentTurn: persistedTurn, ctx } = await getCurrentTurnAndCtx(db);
  const currentTurn = inFlightTurn ?? persistedTurn;
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
  const seatHealOps: AnyBulkWriteOperation<Election>[] = liveElections.flatMap((e) => {
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

  // Existing post-snap races can retain the old canonical cycle's year even
  // though their deadline shifted, and races spawned before the shifted term
  // clock was persisted lack the stamp their successor anchors to. Repair only
  // those two fields, preserving timers.
  for (const live of liveElections) {
    const prev = lastCompleted(live.state);
    if (live.electionType !== "commons" || live.endTurn == null) continue;
    if (live.cycle !== (prev?.cycle ?? 0) + 1) continue;
    const anchor = shiftedAnchorTurn(prev, "commons", "snap_commons", (endTime) =>
      endTimeToLarpTurn(endTime, now, currentTurn)
    );
    if (anchor == null) continue;
    const electionYear = snapElectionResolutionYear(live.endTurn, ctx);
    const $set: Partial<Election> = {};
    if (live.electionYear !== electionYear) $set.electionYear = electionYear;
    if (live.shiftedScheduleEndTurn == null) $set.shiftedScheduleEndTurn = live.endTurn;
    if (Object.keys($set).length === 0) continue;
    seatHealOps.push({
      updateOne: { filter: { _id: live._id }, update: { $set: { ...$set, updatedAt: now } } },
    });
  }
  if (seatHealOps.length > 0) {
    await db.collection<Election>("elections").bulkWrite(seatHealOps);
    console.log(`[Turn] ensureUKElections: healed ${seatHealOps.length} Commons field(s)`);
  }

  const dur = DEFAULT_DURATIONS.commons.durationHours;
  const genDur = getGeneralWindow("commons");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveCommons.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Snap shift: a called snap, and every regular spawned on its shifted
    // term clock, anchors the next regular. See `planNextLowerChamberCycle`.
    const plan = planNextLowerChamberCycle({
      electionType: "commons",
      snapType: "snap_commons",
      prev,
      currentTurn,
      ctx,
      endTimeToTurn: (endTime) => endTimeToLarpTurn(endTime, now, currentTurn),
    });
    if (!plan) continue;
    const { spawn } = plan;

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
      electionYear: plan.electionYear,
      ...(plan.shiftedScheduleEndTurn != null && {
        shiftedScheduleEndTurn: plan.shiftedScheduleEndTurn,
      }),
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
    await db
      .collection<Election>("elections")
      .insertMany(toActuallyInsert.map(withCampaignRules) as Election[]);
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
export async function ensureUKRegionalCouncilElections(
  now: Date,
  inFlightTurn?: number
): Promise<void> {
  const db = await getDb();
  const { currentTurn: persistedTurn, ctx } = await getCurrentTurnAndCtx(db);
  const currentTurn = inFlightTurn ?? persistedTurn;

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
  const devolution = await readUKDevolutionState(db, ctx.startingYear);
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
    const peace = regionId === "NIR" ? devolution.northernIrelandPeace : undefined;
    if (peace && !devolution.regions.NIR.active) continue;
    const peaceAnchor =
      peace?.assemblyFirstElectionEndTurn === undefined
        ? undefined
        : executiveCycleAnchor(
            {
              active: true,
              firstCycle: peace.assemblyFirstCycle ?? 1,
              firstElectionEndTurn: peace.assemblyFirstElectionEndTurn,
            },
            dur
          );
    if (liveCouncils.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Spawn independently on the region's annual-cohort anchor.
    const spawn = pickNextCanonicalCycle({
      electionType: "regionalCouncil",
      prevCycle: Math.max(prev?.cycle ?? 0, (peace?.assemblyFirstCycle ?? 1) - 1),
      currentTurn,
      ctx: peaceAnchor === undefined ? ctx : { ...ctx, preIterationActive: false },
      customCycle1EndTurn: peaceAnchor ?? getUKRegionalCouncilCycle1EndTurn(regionId, ctx),
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
      electionYear:
        peaceAnchor === undefined
          ? getUKRegionalCouncilElectionYear(regionId, spawn.cycle, ctx)
          : yearOfTurn(spawn.endTurn, ctx.startingYear, {
              preIterationTurns: ctx.preIterationTurns,
            }),
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
    await db
      .collection<Election>("elections")
      .insertMany(toActuallyInsert.map(withCampaignRules) as Election[]);
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
 * Existing institutions retain their preset cycle. A newly enacted devolution
 * settlement establishes the first race and anchors later four-year cycles.
 * English non-London regions have no devolved executive and are skipped.
 */
export async function ensureUKGovernorElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureRegionalGovernorElections("UK", now, UK_GOVERNOR_REGIONS, inFlightTurn);
}
