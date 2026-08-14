/**
 * POST /api/admin/elections/sync-date
 *
 * Re-initializes elections with a fresh start date using zero-gap timing:
 * - Resets currentTurn to 1, currentYear to STARTING_YEAR (2020)
 * - Deletes ALL elections, candidates, vote tallies, and campaigns
 * - Creates new elections anchored to their next real-world election year.
 *   All elections start as "active" (primaries open immediately — no "upcoming" gap).
 *   NO elections occur in 2020. Each type bootstraps to:
 *   - House: cycle 1 active now, ends turn 144 (LARP year 2022). Standard 48h general.
 *   - Senate Class 2: active now, ends turn 336 (LARP year 2026). Standard 48h general.
 *   - Senate Class 3: active now, ends turn 144 (LARP year 2022). Standard 48h general.
 *   - Senate Class 1: active now, ends turn 240 (LARP year 2024). Standard 48h general.
 *   - Governor (all): active now, ends turn 240 (LARP year 2024). Standard 48h general.
 *   - State Senate: active now, ends turn 240 (LARP year 2024). Standard 48h general.
 *   - President: active now, ends turn 240 (LARP year 2024). Full primary + 24h general.
 *   - UK Commons: ACTIVE — starts now, cycle 1 ends turn 219 (July 2024 general election)
 *   - UK Regional Council: ACTIVE — starts now, cycle 1 ends turn 219 (synchronized with Commons)
 *   - JP Shugiin: ACTIVE — starts now, cycle 1 ends turn 240 (LARP year 2024)
 *   - JP Sangiin: ACTIVE — Class 1 ends turn 123 (Jul 2022), Class 2 ends turn 267 (Jul 2025)
 *   - JP Governor: ACTIVE — starts now, cycle 1 ends turn 240 (LARP year 2024)
 *   - DE Bundestag: ACTIVE — starts now, cycle 1 ends turn 240 (LARP year 2024)
 *
 * All elections store full DEFAULT_DURATIONS metadata so ensurePerpetualElections
 * correctly inherits full cycle lengths from cycle 2 onward.
 *
 * GameState reset: currentTurn→1, currentYear→2020, lastTurnProcessed→now,
 *   pausedAt→null, nextScheduledTurn→null (prevents stale pause from shifting
 *   newly-created election timestamps when the game restarts).
 *
 * Election-linked data cleared: elections, electionCandidates, electionVoteTallies,
 *   campaigns, primarySnapshot, nppEndorsements, playerEndorsements.
 */
import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";

import type { Election, State, ElectedOfficial, GameState } from "@/lib/db/types";
import {
  SENATE_CLASSES,
  STATE_SENATE_SEATS,
  UK_REGIONAL_COUNCIL_SEATS,
} from "@/lib/constants";
import {
  JP_SHUGIIN_SEATS,
  JP_SANGIIN_SEATS,
  JP_GOVERNOR_SEATS,
  DE_WAHLKREIS_SEATS,
  DE_LANDTAG_SEATS,
  getHouseSeats,
  getUkCommonsSeats,
  getCnNpcSeats,
  getCnPeoplesCongressSeats,
} from "@/lib/constants/states";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import { getLandtagAnchor } from "@/lib/seeds/de/deLandtag";
import { MS_PER_TURN, STARTING_YEAR } from "@/lib/constants/turnTime";
import {
  cycleAnchorContextFromGameState,
  getCycleAnchors,
} from "@/lib/elections/cycleAnchorContext";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats/seatId";
import { invalidateGameTimeCache } from "@/lib/time/gameTime";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

// Sync-date bootstrap anchors are now derived from the active preset's
// `getCycleAnchors(ctx)` inside the POST handler (see ctx-build below).
// Senate class cycle-1 end turns are looked up per-class from the same
// anchor bundle.
const SENATE_CYCLE1_END_TURN_FALLBACK: Record<number, number> = {
  2: 336, // 2026
  3: 144, // 2022
  1: 240, // 2024
};

// POST /api/admin/elections/sync-date — Resets the game to turn 1 and re-initializes all elections from a clean starting slate.
// Auth: requireAdmin
// Errors: 401, 403, 500
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    // Floor to the hour so all election timestamps land on clean turn boundaries.
    // Turns fire at the top of each hour — fractional minutes cause display like "9:33 AM".
    const rawNow = new Date();
    const now = new Date(
      rawNow.getFullYear(),
      rawNow.getMonth(),
      rawNow.getDate(),
      rawNow.getHours(),
      0,
      0,
      0
    );

    // Read the current gameState BEFORE the reset so we can preserve the
    // active preset's startingYear + cycle-anchor context. Without this,
    // the reset would clobber a 1991 game back to the global STARTING_YEAR
    // (2019) and seed elections with 2019-era cycle anchors.
    const existingGameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" } as Filter<GameState>);
    const startingYear = existingGameState?.startingYear ?? STARTING_YEAR;
    const preset = existingGameState?.preset ?? DEFAULT_SEED_PRESET;
    const ctx = cycleAnchorContextFromGameState(existingGameState);
    const anchors = getCycleAnchors(ctx);

    // 1. Reset game state to turn 1 / startingYear. lastTurnProcessed = base for game time.
    // We MUST verify the update matched so that election timestamps (anchored to lastTurnProcessed)
    // and the year-label calculation (which uses lastTurnProcessed as reference) stay in sync.
    // If the document is missing, throw — a missing gameState is a fundamental DB error.
    const updateResult = await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" } as Filter<GameState>, {
        $set: {
          currentTurn: 1,
          currentYear: startingYear,
          lastTurnProcessed: now,
          pausedAt: null, // clear stale pause — avoids shifting new election timestamps
          nextScheduledTurn: null, // clear stale scheduler state
          updatedAt: now,
        },
      });
    if (updateResult.matchedCount === 0) {
      return NextResponse.json(
        { error: "GameState document not found; cannot reset. Run /api/admin/init first." },
        { status: 500 }
      );
    }
    invalidateGameTimeCache(); // ensure next request sees fresh effectiveNow

    // currentTurn was just reset to 1 and `now` == lastTurnProcessed == turn 1.
    // Every election below anchors startTime to `now`, so its turn bounds mirror
    // the Date math exactly: turn = baseTurn + offset-from-now-in-turns (1 turn =
    // 1 hour = 1 MS_PER_TURN). Stamping these means a freshly reset world is
    // turn-resolvable immediately, without waiting on the backfill script.
    const baseTurn = 1;

    // 2. Snapshot old election IDs BEFORE inserting new ones.
    //    Insert-first ordering: new elections are inserted before old ones are deleted so
    //    that a failed insertMany leaves the existing data untouched. A failed deleteMany
    //    after a successful insert is recoverable — a retry of sync-date will include the
    //    old elections in oldElectionIds and clean them up correctly.
    const oldElectionIds = await db
      .collection<Election>("elections")
      .find({}, { projection: { _id: 1 } })
      .toArray()
      .then((docs) => docs.map((d) => d._id));

    // 3. Get states and elected officials to determine what to create
    const states = await db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1, houseDistricts: 1, stateSenateSeats: 1 } })
      .toArray();
    const stateIds = states
      .filter((s) => (s as { countryId?: string }).countryId === "US")
      .map((s) => s._id as string);
    const ukRegionIds = states
      .filter((s) => (s as { countryId?: string }).countryId === "UK")
      .map((s) => s._id as string);
    const jpRegionIds = states
      .filter((s) => (s as { countryId?: string }).countryId === "JP")
      .map((s) => s._id as string);
    const deRegionIds = states
      .filter((s) => (s as { countryId?: string }).countryId === "DE")
      .map((s) => s._id as string);
    const cnRegionIds = states
      .filter((s) => (s as { countryId?: string }).countryId === "CN")
      .map((s) => s._id as string);
    const ruRegions = states.filter((s) => (s as { countryId?: string }).countryId === "RU") as {
      _id: string;
      houseDistricts?: number;
      stateSenateSeats?: number;
    }[];

    const stateSenateStates = new Set(
      (
        await db
          .collection<ElectedOfficial>("electedOfficials")
          .find({ officeType: "stateSenate" }, { projection: { state: 1 } })
          .toArray()
      ).map((o) => o.state)
    );

    const toInsert: Omit<Election, "_id">[] = [];

    for (const stateId of stateIds) {
      // House — single cycle 1 election anchored to LARP year 2022 (turn 144).
      // Zero-gap: primary opens immediately. Standard 48h general window.
      // Full DEFAULT_DURATIONS metadata stored → cycle 2 inherits the normal 96h full cycle.
      const houseDur = DEFAULT_DURATIONS.house;
      const houseEndTime = new Date(now.getTime() + anchors.house * MS_PER_TURN);
      const housePrimaryEndTime = new Date(
        houseEndTime.getTime() - houseDur.generalDurationHours * MS_PER_TURN
      );
      const houseEndTurn = baseTurn + anchors.house;
      const housePrimaryEndTurn = houseEndTurn - houseDur.generalDurationHours;
      toInsert.push({
        electionType: "house",
        state: stateId,
        countryId: "US",
        cycle: 1,
        status: "active",
        totalSeats: getHouseSeats(ctx.preset)[stateId] ?? 1,
        startTime: now,
        primaryEndTime: housePrimaryEndTime,
        endTime: houseEndTime,
        startTurn: baseTurn,
        primaryEndTurn: housePrimaryEndTurn,
        endTurn: houseEndTurn,
        durationHours: houseDur.durationHours, // full — inherited by cycle 2
        primaryDurationHours: houseDur.primaryDurationHours, // full — inherited by cycle 2
        createdAt: now,
        updatedAt: now,
      });

      // Senate — all three classes bootstrap to their correct real-world election years.
      //   Class 3: endTurn = 144 (2022), Class 1: endTurn = 240 (2024), Class 2: endTurn = 336 (2026)
      //   Zero-gap: primary opens immediately. Standard 48h general window for all classes.
      //   Full 288h metadata stored → cycle 2 inherits the normal 6-year cycle.
      const stateClasses = SENATE_CLASSES[stateId] ?? [1, 2];
      const senateDur = DEFAULT_DURATIONS.senate;
      for (const senateClass of stateClasses) {
        const endOffsetTurns =
          senateClass === 1
            ? anchors.senateClass1
            : senateClass === 2
              ? anchors.senateClass2
              : senateClass === 3
                ? anchors.senateClass3
                : (SENATE_CYCLE1_END_TURN_FALLBACK[senateClass] ?? 336);
        const senateEndTime = new Date(now.getTime() + endOffsetTurns * MS_PER_TURN);
        const senatePrimaryEndTime = new Date(
          senateEndTime.getTime() - senateDur.generalDurationHours * MS_PER_TURN
        );
        const senateEndTurn = baseTurn + endOffsetTurns;
        const senatePrimaryEndTurn = senateEndTurn - senateDur.generalDurationHours;
        toInsert.push({
          electionType: "senate",
          state: stateId,
          countryId: "US",
          senateClass,
          cycle: 1,
          status: "active",
          startTime: now,
          primaryEndTime: senatePrimaryEndTime,
          endTime: senateEndTime,
          startTurn: baseTurn,
          primaryEndTurn: senatePrimaryEndTurn,
          endTurn: senateEndTurn,
          durationHours: senateDur.durationHours, // full — inherited by cycle 2
          primaryDurationHours: senateDur.primaryDurationHours, // full — inherited by cycle 2
          createdAt: now,
          updatedAt: now,
        });
      }

      // Governor — all states bootstrap to LARP year 2024 (turn 240). No A/B stagger.
      // Zero-gap: primary opens immediately. Standard 48h general window.
      // Full 192h metadata stored → cycle 2 inherits the normal 4-year cycle.
      const govDur = DEFAULT_DURATIONS.governor;
      const govEndTime = new Date(now.getTime() + anchors.governorStateSenate * MS_PER_TURN);
      const govPrimaryEndTime = new Date(
        govEndTime.getTime() - govDur.generalDurationHours * MS_PER_TURN
      );
      const govEndTurn = baseTurn + anchors.governorStateSenate;
      const govPrimaryEndTurn = govEndTurn - govDur.generalDurationHours;
      toInsert.push({
        electionType: "governor",
        state: stateId,
        countryId: "US",
        cycle: 1,
        status: "active",
        startTime: now,
        primaryEndTime: govPrimaryEndTime,
        endTime: govEndTime,
        startTurn: baseTurn,
        primaryEndTurn: govPrimaryEndTurn,
        endTurn: govEndTurn,
        durationHours: govDur.durationHours, // full — inherited by cycle 2
        primaryDurationHours: govDur.primaryDurationHours, // full — inherited by cycle 2
        createdAt: now,
        updatedAt: now,
      });

      // State Senate — bootstrap to LARP year 2024 (turn 240), only for states that have
      // state senate officials. Zero-gap: primary opens immediately. Standard 48h general.
      if (stateSenateStates.has(stateId)) {
        const ssDur = DEFAULT_DURATIONS.stateSenate;
        const ssEndTime = new Date(now.getTime() + anchors.governorStateSenate * MS_PER_TURN);
        const ssPrimaryEndTime = new Date(
          ssEndTime.getTime() - ssDur.generalDurationHours * MS_PER_TURN
        );
        const ssEndTurn = baseTurn + anchors.governorStateSenate;
        const ssPrimaryEndTurn = ssEndTurn - ssDur.generalDurationHours;
        toInsert.push({
          electionType: "stateSenate",
          state: stateId,
          countryId: "US",
          cycle: 1,
          status: "active",
          totalSeats: STATE_SENATE_SEATS[stateId] ?? 30,
          startTime: now,
          primaryEndTime: ssPrimaryEndTime,
          endTime: ssEndTime,
          startTurn: baseTurn,
          primaryEndTurn: ssPrimaryEndTurn,
          endTurn: ssEndTurn,
          durationHours: ssDur.durationHours,
          primaryDurationHours: ssDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Presidential election — cycle 1, bootstraps to LARP year 2024 (turn 240).
    // Primary opens immediately and uses the canonical presidential general window.
    // Perpetual cycle 2+ auto-spawns each turn via ensurePerpetualElections + the
    // canonical-LARP 24h+24h gate; no separate year-guard is consulted.
    const presDur = DEFAULT_DURATIONS.president;
    const presEndTime = new Date(now.getTime() + anchors.president * MS_PER_TURN);
    const presPrimaryEndTime = new Date(
      presEndTime.getTime() - presDur.generalDurationHours * MS_PER_TURN
    );
    const presEndTurn = baseTurn + anchors.president;
    const presPrimaryEndTurn = presEndTurn - presDur.generalDurationHours;
    toInsert.push({
      electionType: "president",
      state: "US",
      countryId: "US",
      cycle: 1,
      status: "active",
      startTime: now,
      primaryEndTime: presPrimaryEndTime,
      endTime: presEndTime,
      startTurn: baseTurn,
      primaryEndTurn: presPrimaryEndTurn,
      endTurn: presEndTurn,
      durationHours: presDur.durationHours,
      primaryDurationHours: presDur.primaryDurationHours,
      createdAt: now,
      updatedAt: now,
    });

    // UK Commons — cycle 1 bootstrap: ends at July 2024 (turn 219).
    // Cycle 2+ elections recur every 5 game-years; spawning gap handled by ensureUKElections.
    if (ukRegionIds.length > 0) {
      const commonsDur = DEFAULT_DURATIONS.commons;
      const commonsEndTimeH = anchors.ukCommons;
      const commonsPrimaryEndH = commonsEndTimeH - commonsDur.generalDurationHours;

      for (const regionId of ukRegionIds) {
        toInsert.push({
          countryId: "UK",
          electionType: "commons",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: getUkCommonsSeats(preset)[regionId] ?? 1,
          startTime: now,
          primaryEndTime: new Date(now.getTime() + commonsPrimaryEndH * MS_PER_TURN),
          endTime: new Date(now.getTime() + commonsEndTimeH * MS_PER_TURN),
          startTurn: baseTurn,
          primaryEndTurn: baseTurn + commonsPrimaryEndH,
          endTurn: baseTurn + commonsEndTimeH,
          durationHours: commonsDur.durationHours,
          primaryDurationHours: commonsEndTimeH - commonsDur.generalDurationHours, // bootstrap primary fills from now to primaryEndTime
          createdAt: now,
          updatedAt: now,
        });
      }

      // UK Regional Council — cycle 1 bootstrap, synchronized with Commons.
      const rcDur = DEFAULT_DURATIONS.regionalCouncil;
      const rcEndTimeH = anchors.ukCommons; // synchronized with Commons
      const rcPrimaryEndH = rcEndTimeH - rcDur.generalDurationHours;

      for (const regionId of ukRegionIds) {
        toInsert.push({
          countryId: "UK",
          electionType: "regionalCouncil",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: UK_REGIONAL_COUNCIL_SEATS[regionId] ?? 1,
          startTime: now,
          primaryEndTime: new Date(now.getTime() + rcPrimaryEndH * MS_PER_TURN),
          endTime: new Date(now.getTime() + rcEndTimeH * MS_PER_TURN),
          startTurn: baseTurn,
          primaryEndTurn: baseTurn + rcPrimaryEndH,
          endTurn: baseTurn + rcEndTimeH,
          durationHours: rcDur.durationHours,
          primaryDurationHours: rcEndTimeH - rcDur.generalDurationHours, // bootstrap primary fills from now to primaryEndTime
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // JP Shugiin — cycle 1 bootstrap anchored to 2024 (turn 240).
    // 4-year term. Zero-gap: primary opens immediately.
    if (jpRegionIds.length > 0) {
      const shugiinDur = DEFAULT_DURATIONS.shugiin;
      const shugiinEndTime = new Date(now.getTime() + anchors.jpShugiin * MS_PER_TURN);
      const shugiinPrimaryEndTime = new Date(
        shugiinEndTime.getTime() - shugiinDur.generalDurationHours * MS_PER_TURN
      );
      const shugiinEndTurn = baseTurn + anchors.jpShugiin;
      const shugiinPrimaryEndTurn = shugiinEndTurn - shugiinDur.generalDurationHours;

      for (const regionId of jpRegionIds) {
        toInsert.push({
          countryId: "JP",
          electionType: "shugiin",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: JP_SHUGIIN_SEATS[regionId] ?? 1,
          startTime: now,
          primaryEndTime: shugiinPrimaryEndTime,
          endTime: shugiinEndTime,
          startTurn: baseTurn,
          primaryEndTurn: shugiinPrimaryEndTurn,
          endTurn: shugiinEndTurn,
          durationHours: shugiinDur.durationHours,
          primaryDurationHours: shugiinDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }

      // JP Sangiin — half-elections by class. Cycle-1 end turns come from
      // the preset's cycle anchors (Class 1 / Class 2 differ per preset).
      const sangiinDur = DEFAULT_DURATIONS.sangiin;

      for (const regionId of jpRegionIds) {
        // Each region participates in BOTH classes — half seats per class.
        // Both classes active from Turn 1 with different end turns.
        for (const sangiinClass of [1, 2] as const) {
          const endOffsetTurns =
            sangiinClass === 1 ? anchors.jpSangiinClass1 : anchors.jpSangiinClass2;
          const sangiinEndTime = new Date(now.getTime() + endOffsetTurns * MS_PER_TURN);
          const sangiinPrimaryEndTime = new Date(
            sangiinEndTime.getTime() - sangiinDur.generalDurationHours * MS_PER_TURN
          );
          const sangiinEndTurn = baseTurn + endOffsetTurns;
          const sangiinPrimaryEndTurn = sangiinEndTurn - sangiinDur.generalDurationHours;
          toInsert.push({
            countryId: "JP",
            electionType: "sangiin",
            state: regionId,
            chamberClass: sangiinClass,
            cycle: 1,
            status: "active",
            totalSeats: Math.ceil((JP_SANGIIN_SEATS[regionId] ?? 2) / 2),
            startTime: now,
            primaryEndTime: sangiinPrimaryEndTime,
            endTime: sangiinEndTime,
            startTurn: baseTurn,
            primaryEndTurn: sangiinPrimaryEndTurn,
            endTurn: sangiinEndTurn,
            durationHours: sangiinDur.durationHours,
            primaryDurationHours: sangiinDur.primaryDurationHours,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // JP Governor — anchors to the same governor-class end-turn as US.
      const jpGovDur = DEFAULT_DURATIONS.governor;
      const jpGovEndTime = new Date(now.getTime() + anchors.governorStateSenate * MS_PER_TURN);
      const jpGovPrimaryEndTime = new Date(
        jpGovEndTime.getTime() - jpGovDur.generalDurationHours * MS_PER_TURN
      );
      const jpGovEndTurn = baseTurn + anchors.governorStateSenate;
      const jpGovPrimaryEndTurn = jpGovEndTurn - jpGovDur.generalDurationHours;

      for (const regionId of jpRegionIds) {
        toInsert.push({
          countryId: "JP",
          electionType: "governor",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: JP_GOVERNOR_SEATS[regionId] ?? 1,
          startTime: now,
          primaryEndTime: jpGovPrimaryEndTime,
          endTime: jpGovEndTime,
          startTurn: baseTurn,
          primaryEndTurn: jpGovPrimaryEndTurn,
          endTurn: jpGovEndTurn,
          durationHours: jpGovDur.durationHours,
          primaryDurationHours: jpGovDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // DE Bundestag — cycle 1 bootstrap anchored to 2024 (turn 240).
    // 4-year term. Zero-gap: primary opens immediately.
    if (deRegionIds.length > 0) {
      const bundestagDur = DEFAULT_DURATIONS.bundestag;
      const bundestagEndTime = new Date(now.getTime() + anchors.deBundestag * MS_PER_TURN);
      const bundestagPrimaryEndTime = new Date(
        bundestagEndTime.getTime() - bundestagDur.generalDurationHours * MS_PER_TURN
      );
      const bundestagEndTurn = baseTurn + anchors.deBundestag;
      const bundestagPrimaryEndTurn = bundestagEndTurn - bundestagDur.generalDurationHours;

      for (const regionId of deRegionIds) {
        toInsert.push({
          countryId: "DE",
          electionType: "bundestag",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: DE_WAHLKREIS_SEATS[regionId] ?? 1,
          startTime: now,
          primaryEndTime: bundestagPrimaryEndTime,
          endTime: bundestagEndTime,
          startTurn: baseTurn,
          primaryEndTurn: bundestagPrimaryEndTurn,
          endTurn: bundestagEndTurn,
          durationHours: bundestagDur.durationHours,
          primaryDurationHours: bundestagDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // DE Landtag — per-Land staggered 5-year cycles. Cycle 1 anchors come from
    // getLandtagAnchor(regionId, preset) (2026–2030 depending on the Land's real-
    // world election calendar). Zero-gap: primary opens immediately for every
    // Land. Proportional Sainte-Laguë allocation across the Land's stateSenate
    // seat count (see DE_LANDTAG_SEATS / germanyLandtag.ts).
    if (deRegionIds.length > 0) {
      const landtagDur = DEFAULT_DURATIONS.landtag ?? DEFAULT_DURATIONS.bundestag;
      for (const regionId of deRegionIds) {
        const cycle1EndTurn = getLandtagAnchor(regionId, preset);
        if (cycle1EndTurn == null) continue; // Land without a canonical anchor — perpetual phase fills it in.
        const landtagEndTime = new Date(now.getTime() + cycle1EndTurn * MS_PER_TURN);
        const landtagPrimaryEndTime = new Date(
          landtagEndTime.getTime() - landtagDur.generalDurationHours * MS_PER_TURN
        );
        const landtagEndTurn = baseTurn + cycle1EndTurn;
        const landtagPrimaryEndTurn = landtagEndTurn - landtagDur.generalDurationHours;
        toInsert.push({
          countryId: "DE",
          electionType: "landtag",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: DE_LANDTAG_SEATS[regionId] ?? 1,
          startTime: now,
          primaryEndTime: landtagPrimaryEndTime,
          endTime: landtagEndTime,
          startTurn: baseTurn,
          primaryEndTurn: landtagPrimaryEndTurn,
          endTurn: landtagEndTurn,
          durationHours: landtagDur.durationHours,
          primaryDurationHours: landtagDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // CN NPC Delegate — cycle 1 bootstrap anchored to the next NPC plenary
    // (14th NPC = 2023 for 2019-default; 8th NPC = 1993 for 1991-default).
    // 5-year term. Zero-gap: primary opens immediately.
    if (cnRegionIds.length > 0) {
      const npcDur = DEFAULT_DURATIONS.npcDelegate;
      const npcEndTime = new Date(now.getTime() + anchors.cnNpcDelegate * MS_PER_TURN);
      const npcPrimaryEndTime = new Date(
        npcEndTime.getTime() - npcDur.generalDurationHours * MS_PER_TURN
      );
      const npcEndTurn = baseTurn + anchors.cnNpcDelegate;
      const npcPrimaryEndTurn = npcEndTurn - npcDur.generalDurationHours;

      for (const regionId of cnRegionIds) {
        toInsert.push({
          countryId: "CN",
          electionType: "npcDelegate",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: getCnNpcSeats(ctx.preset)[regionId] ?? 1,
          startTime: now,
          primaryEndTime: npcPrimaryEndTime,
          endTime: npcEndTime,
          startTurn: baseTurn,
          primaryEndTurn: npcPrimaryEndTurn,
          endTurn: npcEndTurn,
          durationHours: npcDur.durationHours,
          primaryDurationHours: npcDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }

      // CN Provincial People's Congress — cycle 1 bootstrap, synchronized
      // with NPC plenary so both chambers fire on the same turn.
      const ppcDur = DEFAULT_DURATIONS.peoplesCongress;
      const ppcEndTime = npcEndTime; // synced with NPC
      const ppcPrimaryEndTime = new Date(
        ppcEndTime.getTime() - ppcDur.generalDurationHours * MS_PER_TURN
      );
      const ppcEndTurn = npcEndTurn; // synced with NPC
      const ppcPrimaryEndTurn = ppcEndTurn - ppcDur.generalDurationHours;

      for (const regionId of cnRegionIds) {
        toInsert.push({
          countryId: "CN",
          electionType: "peoplesCongress",
          state: regionId,
          cycle: 1,
          status: "active",
          totalSeats: getCnPeoplesCongressSeats(ctx.preset)[regionId] ?? 1,
          startTime: now,
          primaryEndTime: ppcPrimaryEndTime,
          endTime: ppcEndTime,
          startTurn: baseTurn,
          primaryEndTurn: ppcPrimaryEndTurn,
          endTurn: ppcEndTurn,
          durationHours: ppcDur.durationHours,
          primaryDurationHours: ppcDur.primaryDurationHours,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // RU Supreme Soviet (Union + Nationalities), republic Supreme Soviets, and
    // republic First Secretaries — Cold-War presets only. The ruSupremeSoviet /
    // ruRepublicSoviet anchors are null outside 1953/1979 (D10 era gating), and
    // the country must be runtime-live (beta/active) to mirror the perpetual
    // spawners' countryElectionsLive gate, so a coming-soon RU stays static.
    if (ruRegions.length > 0 && anchors.ruSupremeSoviet != null) {
      const { status: ruStatus } = await getCountryAccessFromDb(db, "RU");
      if (ruStatus === "beta" || ruStatus === "active") {
        // Union apportionment = live houseDistricts; republic soviets read the
        // region's authored chamber size (stateSenateSeats) — both mirror the
        // perpetual spawners so bootstrap and steady-state never disagree.
        const ruHouseSeats = Object.fromEntries(
          ruRegions.map((r) => [r._id, r.houseDistricts ?? 1])
        );

        // Both federal chambers fire same-day on the ruSupremeSoviet anchor (D1).
        const unionDur = DEFAULT_DURATIONS.supremeSovietDeputy;
        const natDur = DEFAULT_DURATIONS.nationalitiesDeputy;
        const ssEndTime = new Date(now.getTime() + anchors.ruSupremeSoviet * MS_PER_TURN);
        const ssEndTurn = baseTurn + anchors.ruSupremeSoviet;
        for (const region of ruRegions) {
          toInsert.push({
            countryId: "RU",
            electionType: "supremeSovietDeputy",
            state: region._id,
            cycle: 1,
            status: "active",
            totalSeats: ruHouseSeats[region._id] ?? 1,
            startTime: now,
            primaryEndTime: new Date(
              ssEndTime.getTime() - unionDur.generalDurationHours * MS_PER_TURN
            ),
            endTime: ssEndTime,
            startTurn: baseTurn,
            primaryEndTurn: ssEndTurn - unionDur.generalDurationHours,
            endTurn: ssEndTurn,
            durationHours: unionDur.durationHours,
            primaryDurationHours: unionDur.primaryDurationHours,
            createdAt: now,
            updatedAt: now,
          });
          toInsert.push({
            countryId: "RU",
            electionType: "nationalitiesDeputy",
            state: region._id,
            cycle: 1,
            status: "active",
            totalSeats: RU_NATIONALITIES_SEATS[region._id] ?? 20,
            startTime: now,
            primaryEndTime: new Date(
              ssEndTime.getTime() - natDur.generalDurationHours * MS_PER_TURN
            ),
            endTime: ssEndTime,
            startTurn: baseTurn,
            primaryEndTurn: ssEndTurn - natDur.generalDurationHours,
            endTurn: ssEndTurn,
            durationHours: natDur.durationHours,
            primaryDurationHours: natDur.primaryDurationHours,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Republic soviets + First Secretaries share the ruRepublicSoviet
        // anchor (the D10 governor override in canonicalCycle.ts).
        if (anchors.ruRepublicSoviet != null) {
          const republicSeats = Object.fromEntries(
            ruRegions.map((r) => [r._id, r.stateSenateSeats ?? 1])
          );
          const repDur = DEFAULT_DURATIONS.republicSupremeSoviet;
          const ruGovDur = DEFAULT_DURATIONS.governor;
          const repEndTime = new Date(now.getTime() + anchors.ruRepublicSoviet * MS_PER_TURN);
          const repEndTurn = baseTurn + anchors.ruRepublicSoviet;
          for (const region of ruRegions) {
            toInsert.push({
              countryId: "RU",
              electionType: "republicSupremeSoviet",
              state: region._id,
              cycle: 1,
              status: "active",
              totalSeats: republicSeats[region._id] ?? 1,
              startTime: now,
              primaryEndTime: new Date(
                repEndTime.getTime() - repDur.generalDurationHours * MS_PER_TURN
              ),
              endTime: repEndTime,
              startTurn: baseTurn,
              primaryEndTurn: repEndTurn - repDur.generalDurationHours,
              endTurn: repEndTurn,
              durationHours: repDur.durationHours,
              primaryDurationHours: repDur.primaryDurationHours,
              createdAt: now,
              updatedAt: now,
            });
            toInsert.push({
              countryId: "RU",
              electionType: "governor",
              state: region._id,
              cycle: 1,
              status: "active",
              totalSeats: 1,
              startTime: now,
              primaryEndTime: new Date(
                repEndTime.getTime() - ruGovDur.generalDurationHours * MS_PER_TURN
              ),
              endTime: repEndTime,
              startTurn: baseTurn,
              primaryEndTurn: repEndTurn - ruGovDur.generalDurationHours,
              endTurn: repEndTurn,
              durationHours: ruGovDur.durationHours,
              primaryDurationHours: ruGovDur.primaryDurationHours,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }
    }

    // Populate seatId on every election for friendly URL routing
    for (const election of toInsert) {
      election.seatId = getSeatIdFromElection(
        election as Parameters<typeof getSeatIdFromElection>[0]
      );
    }

    // Bake the LARP election year on every spawned doc so display callers
    // don't have to re-derive it from cycle + preset at read time.
    for (const election of toInsert) {
      election.electionYear = electionToLarpYear(
        election.electionType,
        election.cycle,
        election.senateClass,
        election.chamberClass,
        ctx,
        election.countryId as CountryId | undefined
      );
    }

    // 3. Insert new elections FIRST. If this throws, old data is still intact and the
    //    admin can safely retry. Any partial inserts from a prior failed attempt will be
    //    treated as "old" elections and cleaned up by the delete step that follows.
    if (toInsert.length > 0) {
      await db.collection<Election>("elections").insertMany(toInsert as Election[]);
    }

    // 4. Delete old elections and all their linked data (candidates, tallies, etc.).
    //    Scoped to the IDs captured before insert so new elections are never touched.
    let deletedCount = 0;
    if (oldElectionIds.length > 0) {
      await Promise.all([
        db.collection("electionCandidates").deleteMany({ electionId: { $in: oldElectionIds } }),
        db.collection("electionVoteTallies").deleteMany({ electionId: { $in: oldElectionIds } }),
        db.collection("campaigns").deleteMany({ electionId: { $in: oldElectionIds } }),
        // Clear election-linked data that persists beyond the elections collection:
        // primary snapshots captured at primary close, and NPP/player endorsements tied
        // to specific races — all become orphaned when elections are deleted.
        db.collection("primarySnapshot").deleteMany({ electionId: { $in: oldElectionIds } }),
        db.collection("nppEndorsements").deleteMany({ electionId: { $in: oldElectionIds } }),
        db.collection("playerEndorsements").deleteMany({ electionId: { $in: oldElectionIds } }),
      ]);
      const deleteResult = await db
        .collection("elections")
        .deleteMany({ _id: { $in: oldElectionIds } });
      deletedCount = deleteResult.deletedCount;
    }

    const counts = {
      deleted: deletedCount,
      created: toInsert.length,
      president: toInsert.filter((e) => e.electionType === "president").length,
      house: toInsert.filter((e) => e.electionType === "house").length,
      senate: toInsert.filter((e) => e.electionType === "senate").length,
      governor: toInsert.filter((e) => e.electionType === "governor").length,
      stateSenate: toInsert.filter((e) => e.electionType === "stateSenate").length,
      commons: toInsert.filter((e) => e.electionType === "commons").length,
      regionalCouncil: toInsert.filter((e) => e.electionType === "regionalCouncil").length,
      shugiin: toInsert.filter((e) => e.electionType === "shugiin").length,
      sangiin: toInsert.filter((e) => e.electionType === "sangiin").length,
      bundestag: toInsert.filter((e) => e.electionType === "bundestag").length,
      landtag: toInsert.filter((e) => e.electionType === "landtag").length,
      jpGovernor: toInsert.filter((e) => e.electionType === "governor" && e.countryId === "JP")
        .length,
      npcDelegate: toInsert.filter((e) => e.electionType === "npcDelegate").length,
      peoplesCongress: toInsert.filter((e) => e.electionType === "peoplesCongress").length,
      supremeSovietDeputy: toInsert.filter((e) => e.electionType === "supremeSovietDeputy").length,
      nationalitiesDeputy: toInsert.filter((e) => e.electionType === "nationalitiesDeputy").length,
      republicSupremeSoviet: toInsert.filter((e) => e.electionType === "republicSupremeSoviet")
        .length,
      ruGovernor: toInsert.filter((e) => e.electionType === "governor" && e.countryId === "RU")
        .length,
    };

    return NextResponse.json({
      success: true,
      message:
        `Sync complete. Turn reset to 1. Deleted ${counts.deleted} elections, created ${counts.created} (` +
        `President: ${counts.president} [full primary→2024, turn 240], ` +
        `House: ${counts.house} [cycle 1 active now→2022, turn 144], ` +
        `Senate: ${counts.senate} [Class 3→2022 (turn 144); Class 1→2024 (turn 240); Class 2→2026 (turn 336)], ` +
        `Governor: ${counts.governor} [all states→2024, turn 240], ` +
        `State Senate: ${counts.stateSenate} [all states→2024, turn 240], ` +
        `UK Commons: ${counts.commons} [cycle 1 active now, ends 2024 (turn 219); cycle 2+ = 240 turns (5yr)], ` +
        `UK Regional Council: ${counts.regionalCouncil} [cycle 1 active now, ends 2024 (turn 219)], ` +
        `JP Shugiin: ${counts.shugiin} [cycle 1→2024 (turn 240)], ` +
        `JP Sangiin: ${counts.sangiin} [Class 1→2022 (turn 144); Class 2→2025 (turn 288)], ` +
        `JP Governor: ${counts.jpGovernor} [all regions→2024 (turn 240)], ` +
        `DE Bundestag: ${counts.bundestag} [cycle 1→2024 (turn 240)], ` +
        `DE Landtag: ${counts.landtag} [per-Land staggered 2026–2030], ` +
        `CN NPC Delegate: ${counts.npcDelegate} [cycle 1→14th NPC 2023], ` +
        `CN Provincial People's Congress: ${counts.peoplesCongress} [synced with NPC], ` +
        `RU Supreme Soviet (Union): ${counts.supremeSovietDeputy} [Cold-War anchor], ` +
        `RU Soviet of Nationalities: ${counts.nationalitiesDeputy} [same-day as Union], ` +
        `RU Republic Soviets: ${counts.republicSupremeSoviet} [republic anchor], ` +
        `RU First Secretaries: ${counts.ruGovernor} [synced with republic soviets]` +
        `). No elections occur in 2020. Full cycle lengths resume from cycle 2 onward.`,
      counts,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
