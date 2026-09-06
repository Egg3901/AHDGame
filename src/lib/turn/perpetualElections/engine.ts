import { AsyncLocalStorage } from "async_hooks";
import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCountryAccessFromDb, withCountryAccessSnapshot } from "@/lib/countryAccess";
import type { Election, GameState, Seat, State } from "@/lib/db/types";
import { CURRENT_PRESIDENTIAL_RULESET_VERSION } from "@/lib/elections/presidentialRuleset";
import { US_STATE_FILTER } from "@/lib/utils/electionLabels";
import { MS_PER_TURN, STARTING_YEAR } from "@/lib/constants/turnTime";
import { SENATE_CLASSES } from "@/lib/constants";
import { getHouseSeats, isUsElectoralState } from "@/lib/constants/states";
import { loadApportionment } from "@/lib/elections/apportionment";
import { admittedStateIdsAsOf, TERRITORY_ADMISSIONS } from "@/lib/elections/statehoodAdmission";
import { buildUsTerritorialGovernorSeat } from "@/lib/admin/seed/seedSeats";
import { type CountryId } from "@/lib/constants/countries";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";
import {
  cycleAnchorContextFromGameState,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";
import {
  sendCountryGameEventMultiple,
  DISCORD_COLORS,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { ELECTION_TYPE_SHORT_LABEL } from "@/lib/utils/electionLabels";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getSeatIdFromElection } from "@/lib/seats";
import type { GameTimeContext } from "@/lib/time/gameTime";
import { hasElectionStarted, isElectionEnded } from "@/lib/elections/phases";

/**
 * NG elections run once Nigeria is off "coming-soon". Gated on the RUNTIME
 * status (`countryGameStates.status`, resolved via getCountryAccessFromDb — the
 * same two-tier DB-over-config source the admin panel and country layout use),
 * NOT the static config, so flipping the admin status to "beta"/"active" turns
 * the whole cycle on with no redeploy. Until then every NG election phase is a
 * no-op, so a coming-soon NG never spawns NPC elections on the live world.
 *
 * Explicit allow-list (not `!== "coming-soon"`) so an unexpected/new status
 * never silently enables spawning — only "beta" and "active" are live.
 */
export async function ngElectionsLive(db: Db): Promise<boolean> {
  const { status } = await getCountryAccessFromDb(db, "NG");
  return status === "beta" || status === "active";
}

// Re-export so existing consumers (sync-date, snapElection, admin routes,
// etc.) that import DEFAULT_DURATIONS from this module keep working.

export function getGeneralWindow(electionType: string): number {
  return DEFAULT_DURATIONS[electionType]?.generalDurationHours ?? 48;
}

/**
 * Guard against same-tick respawn: when a perpetual cycle resolves, the turn
 * processor runs `ensure*` spawners in the same tick. If canonical math
 * permits, a new cycle can spawn immediately ("active") in that same run —
 * this cascades admin-accelerated cycles (compressed timers) into back-to-back
 * races with no visible gap, which confuses players who reasonably read the
 * sequence as "primary → general of the same election."
 *
 * "Same tick" requires BOTH signals when both are available:
 *   • wall-clock: `prev.updatedAt` less than one real hour before `now`, AND
 *   • turn:       `currentTurn` has not advanced past the turn the race
 *                 completed on (`currentTurn <= prev.endTurn`).
 *
 * The turn condition is essential for headless/accelerated sims where turns
 * fire seconds apart: a wall-clock-only guard stays shut for hundreds of
 * turns after each resolution, silently suppressing every ensure-based
 * respawn (US president/senate/governor, JP, IE, CN, BR, …) and freezing
 * those cycles at 1 while only the resolution-path respawns (house/commons)
 * kept cycling (found in sandbox ahd_sim_s1991-base-a: the 1992 president
 * resolved at t96, no 1996 race existed by t301). The wall-clock condition
 * remains so a paused/late world whose `currentTurn` still equals the prior
 * `endTurn` (back-to-back canonical windows) isn't blocked when resolution
 * actually happened long ago. On prod (1 turn = 1 real hour) the combined
 * guard behaves exactly like the original wall-clock one. Callers that
 * can't supply `currentTurn` (or legacy docs without `endTurn`) fall back
 * to wall-clock only.
 */
export function justResolvedInSameTurn(
  prev: Election | undefined,
  now: Date,
  currentTurn?: number
): boolean {
  if (!prev?.updatedAt) return false;
  const withinWallClockTurn = now.getTime() - new Date(prev.updatedAt).getTime() < MS_PER_TURN;
  if (currentTurn != null && prev.endTurn != null) {
    return withinWallClockTurn && currentTurn <= prev.endTurn;
  }
  return withinWallClockTurn;
}

export type TurnAndCtx = { currentTurn: number; currentYear: number; ctx: CycleAnchorContext };

/**
 * Dynamically-scoped snapshot of the one GameState read every `ensure*` spawner
 * makes. See {@link withElectionGameStateSnapshot}.
 *
 * ⚠️ Deliberately AsyncLocalStorage and NOT a module-level cache. A module-level
 * cache would outlive the scope that created it and serve a stale `currentTurn`
 * to the next turn's spawners — and the reset writes `gameState` mid-run
 * (`isActive: false` at the seal, `preset` at `stampInitialGameClock`), so a
 * cache filled before those writes would hand out a pre-stamp preset. That is
 * exactly the failure that nearly shipped the A6 fix as a silent no-op. Here the
 * store exists only for the dynamic extent of one callback and cannot leak.
 */
declare global {
  var __ahdElectionGameStateSnapshot: AsyncLocalStorage<TurnAndCtx> | undefined;
}

/**
 * Pinned to `globalThis` because the store only works if there is exactly one
 * of it. This module used to be the single 4,000-line `perpetualElections.ts`,
 * where that was guaranteed; now the country schedulers that call
 * `getCurrentTurnAndCtx` live in sibling modules, and a Next build that emits
 * this file into more than one bundle would give the reader a different
 * AsyncLocalStorage than the writer — so every spawner would silently miss the
 * snapshot and fall back to its own findOne. Same globalThis guard the other
 * cross-bundle singletons in this codebase use.
 */
export const electionGameStateSnapshot: AsyncLocalStorage<TurnAndCtx> =
  globalThis.__ahdElectionGameStateSnapshot ??
  (globalThis.__ahdElectionGameStateSnapshot = new AsyncLocalStorage<TurnAndCtx>());

/**
 * Read GameState ONCE and serve it to every `ensure*` spawner called inside
 * `fn`, instead of one findOne per spawner.
 *
 * ⚠️ Only valid where nothing in `fn` writes `gameState` or advances the turn.
 * `perpetualElections.ts` never writes it, so the constraint is on the caller.
 * The bootstrap election battery satisfies it: bootstrap runs no turns, and its
 * gameState writes all happen before the battery. The per-turn callers
 * deliberately do NOT use this — they must observe their own turn's write.
 */
export async function withElectionGameStateSnapshot<T>(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  fn: () => Promise<T>
): Promise<T> {
  // Country access is snapshotted alongside the turn context: every spawner
  // also asks `getCountryAccessFromDb` for its own country's status gate, which
  // was a findOne per family. Composed here rather than at each call site so the
  // two scopes cannot drift apart — the same window is valid for both, since the
  // spawners are read-only with respect to `countryGameStates` too.
  return withCountryAccessSnapshot(db, async () =>
    electionGameStateSnapshot.run(await readCurrentTurnAndCtx(db), fn)
  );
}

export async function readCurrentTurnAndCtx(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>
): Promise<TurnAndCtx> {
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const ctx = cycleAnchorContextFromGameState(gs);
  return {
    currentTurn: gs?.currentTurn ?? 1,
    // The statehood gate needs the live year. Falling back to the era's start
    // year keeps a world with no stamped year pre-admission rather than
    // accidentally admitting on a missing field.
    currentYear: gs?.currentYear ?? ctx.startingYear,
    ctx,
  };
}

/**
 * Single GameState read returning both the current turn and the
 * preset-aware cycle-anchor context. Used by every `ensure*` spawner so
 * canonical-cycle math reflects the active preset (1991 elections happen
 * in 1992-1996, 2019 elections happen in 2022-2026, etc.).
 *
 * Serves the ambient snapshot when one is open; otherwise reads, exactly as
 * before. Callers outside a snapshot scope are unchanged.
 */
export async function getCurrentTurnAndCtx(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>
): Promise<TurnAndCtx> {
  return electionGameStateSnapshot.getStore() ?? (await readCurrentTurnAndCtx(db));
}

/**
 * Send batched election announcement embeds to Discord.
 * Groups elections by type and status (upcoming vs active/primary open).
 */
export async function sendBatchedElectionAnnouncements(
  elections: Omit<Election, "_id">[],
  now: Date
): Promise<void> {
  if (elections.length === 0) return;

  // Group by countryId + electionType + status. Grouping without countryId
  // let elections of the same electionType from different countries (e.g. a
  // US and an IE race both typed "governor") get merged into a single embed
  // and routed to only the first election's country webhook — the batch's
  // other-country results silently posted into the wrong country's channel.
  // Keyed with a literal space separator (not "_") since electionType itself
  // contains underscores (e.g. "snap_commons").
  const grouped = new Map<string, Omit<Election, "_id">[]>();

  for (const e of elections) {
    const status = e.status === "active" ? "active" : "upcoming";
    const key = `${e.countryId} ${e.electionType} ${status}`;
    const existing = grouped.get(key) ?? [];
    existing.push(e);
    grouped.set(key, existing);
  }

  for (const groupElections of grouped.values()) {
    const electionType = groupElections[0].electionType;
    const isActive = groupElections[0].status === "active";
    const label = ELECTION_TYPE_SHORT_LABEL[electionType] ?? electionType;
    const title = isActive ? `Primary Open — ${label}` : `Election Upcoming — ${label}`;

    // Sort by state alphabetically
    const sorted = [...groupElections].sort((a, b) => a.state.localeCompare(b.state));

    // Build state list with links to each state page
    const baseUrl = "https://ahousedivided.app";
    const stateLinks = sorted.map((e) => `[${e.state}](${baseUrl}/state/${e.state})`);
    const stateList = stateLinks.join(", ");

    // Build fields showing states grouped (truncate if too long)
    const description = isActive
      ? `The **${label}** primary is now open. Candidates may declare.`
      : `**${label}** elections have been scheduled.`;

    const embeds: DiscordEmbed[] = [
      {
        title,
        description: `${description}\n\n**States:** ${stateList.length > 1800 ? stateList.slice(0, 1800) + "..." : stateList}`,
        color: DISCORD_COLORS.electionOpen,
        footer: {
          text: `${sorted.length} race${sorted.length === 1 ? "" : "s"} • A House Divided`,
        },
        timestamp: now.toISOString(),
      },
    ];

    const electionCountryId = groupElections[0]?.countryId ?? "US";
    await sendCountryGameEventMultiple(electionCountryId, embeds).catch(() => {});
  }
}

/**
 * Advance election timers: one turn = one game hour.
 *
 * Turn-first resolution — an election goes active when the processed turn
 * reaches its `startTurn`, and completes when it reaches its `endTurn`. The
 * absolute Dates remain for display and as a permanent fallback for docs not
 * yet backfilled. Because the comparison is turn-based, paused turns freeze
 * every countdown: no turn advances, so no deadline moves — eliminating the
 * wall-clock vs game-clock drift.
 *
 * `currentTurn` is the in-flight turn being processed (threaded from `newTurn`
 * at the registry caller), NOT `gameState.currentTurn`, which is still the
 * prior turn until the end of `processTurn`.
 */
export async function advanceElectionTimers(
  now: Date,
  currentTurn: number,
  resolvePrimaries: (now: Date) => Promise<void>,
  /** Optional harness restriction to specific elections; absent = all. */
  onlyElectionIds?: ObjectId[]
): Promise<void> {
  const db = await getDb();

  const elections = await db
    .collection<Election>("elections")
    .find({
      ...(onlyElectionIds ? { _id: { $in: onlyElectionIds } } : {}),
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();

  // `now` is the game-time of the turn being processed, so it doubles as
  // effectiveNow for the Date fallback inside the phase helpers.
  const gameTime: GameTimeContext = {
    currentTurn,
    lastTurnProcessed: now,
    isActive: true,
    pausedAt: null,
    effectiveNow: now,
    // Inert here — the phase helpers only read effectiveNow for the Date fallback.
    startingYear: STARTING_YEAR,
  };

  const ops: {
    updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
  }[] = [];

  for (const election of elections) {
    const updates: Record<string, Date | string> = { updatedAt: now };

    if (election.status === "upcoming") {
      if (hasElectionStarted(election, currentTurn, gameTime)) updates.status = "active";
    }
    if (isElectionEnded(election, currentTurn, gameTime)) updates.status = "completed";

    ops.push({
      updateOne: {
        filter: { _id: election._id },
        update: { $set: updates },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection<Election>("elections").bulkWrite(ops);
    console.log(`[Turn] Advanced timers for ${ops.length} election(s)`);
  }

  await resolvePrimaries(now);
}

/**
 * Remove duplicate active/upcoming elections, keeping only the oldest one.
 * This prevents issues from race conditions or bugs that create multiple elections.
 */
export async function cleanupDuplicateElections(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>
): Promise<void> {
  const liveElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["active", "upcoming"] } })
    .sort({ createdAt: 1 }) // Oldest first
    .toArray();

  // Group by unique key (countryId + type + state + class when applicable).
  // Class-staggered races share a state but are distinct contests — keying without
  // class would cause one to be deleted as a "duplicate" when both are concurrently
  // active (e.g. JP Sangiin Class 1 cycle 2 spawning while Class 2 cycle 1 is live).
  const groups = new Map<string, Election[]>();
  for (const e of liveElections) {
    let key = `${e.countryId ?? "US"}_${e.electionType}_${e.state}`;
    if (e.electionType === "senate" && e.senateClass) {
      key += `_${e.senateClass}`;
    }
    if (e.electionType === "sangiin" && e.chamberClass) {
      key += `_${e.chamberClass}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // Delete duplicates (keep the oldest).
  // House elections intentionally have 2 concurrent live races (one active + one upcoming)
  // so the next cycle is pre-staged while the current cycle is running.
  const toDelete: import("mongodb").ObjectId[] = [];
  for (const [key, elections] of Array.from(groups.entries())) {
    const maxAllowed = key.includes("_house_") ? 2 : 1;
    if (elections.length > maxAllowed) {
      for (let i = maxAllowed; i < elections.length; i++) {
        toDelete.push(elections[i]._id);
      }
      console.log(
        `[Turn] Found ${elections.length} duplicate ${key} elections, keeping ${maxAllowed}`
      );
    }
  }

  if (toDelete.length > 0) {
    await db.collection("elections").deleteMany({ _id: { $in: toDelete } });
    console.log(`[Turn] Deleted ${toDelete.length} duplicate election(s)`);
  }
}

/**
 * Build an election doc anchored to the canonical LARP schedule. Returns null
 * when `pickNextCanonicalCycle` rejects every candidate cycle (e.g. an
 * unknown election type). Consolidates the wall-clock conversion + status
 * inference so each caller in `ensurePerpetualElections` only supplies the
 * type-specific scaffolding (seats, state, class labels).
 */
export function buildCanonicalSpawn(params: {
  electionType: string;
  countryId: CountryId;
  state: string;
  senateClass?: 1 | 2 | 3;
  chamberClass?: 1 | 2;
  prev: Election | undefined;
  currentTurn: number;
  now: Date;
  fallbackTotalSeats: number;
  ctx: CycleAnchorContext;
  /**
   * Open the primary immediately on spawn instead of honoring the canonical
   * `startTurn`. Used by short-window types (IE/CN/BR) whose cycle period far
   * exceeds their `durationHours`: without this the next cycle's canonical
   * `startTurn` (= endTurn − durationHours) lands long after the prior general
   * ends, leaving a multi-turn "Opens in X turns" dead zone where candidates
   * cannot register. Mirrors the shipped DE/regional-governor behavior — the
   * primary fills the gap; `primaryEndTurn` / `endTurn` stay canonical so the
   * general still lands on its real-world year. No-op for types whose canonical
   * `startTurn` already equals the prior `endTurn` (US/JP-shugiin).
   */
  openPrimaryImmediately?: boolean;
  /**
   * Seceded-country standup: the chamber/office did not exist at game start, so
   * cycle 1 must NOT anchor filing to the turn-1 bootstrap (which spans the whole
   * game and reads as a stale always-active race). Use a normal fixed-length
   * window ending at the canonical anchor instead.
   */
  freshStandup?: boolean;
}): Omit<Election, "_id"> | null {
  const {
    electionType,
    countryId,
    state,
    senateClass,
    chamberClass,
    prev,
    currentTurn,
    now,
    fallbackTotalSeats,
    ctx,
    openPrimaryImmediately,
    freshStandup,
  } = params;

  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return null;

  // Skip spawning when the prior cycle resolved within the current turn —
  // avoids same-tick respawn cascades following admin-compressed elections.
  // The next turn's `ensure*` run will retry and spawn normally.
  if (justResolvedInSameTurn(prev, now, currentTurn)) return null;

  const spawn = pickNextCanonicalCycle({
    electionType,
    countryId,
    senateClass,
    chamberClass,
    prevCycle: prev?.cycle ?? 0,
    currentTurn,
    ctx,
  });
  if (!spawn) return null;

  // A seceded standup's cycle-1 race uses a fixed-length window ending at the
  // canonical anchor, not the turn-1 game-start bootstrap (which it never lived
  // through). For cycle ≥2 the canonical startTurn is already endTurn − duration.
  const canonicalStartTurn =
    freshStandup && spawn.cycle === 1 ? spawn.endTurn - dur.durationHours : spawn.startTurn;

  // When opening immediately, the primary starts at `currentTurn`/`now` and the
  // race is `active`; otherwise honor the (possibly standup-corrected) startTurn.
  const openNow = openPrimaryImmediately === true;
  const startTurn = openNow ? currentTurn : canonicalStartTurn;
  const startTime = openNow ? now : turnToWallClock(canonicalStartTurn, now, currentTurn);
  const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
  const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);
  const status: "active" | "upcoming" =
    openNow || canonicalStartTurn <= currentTurn ? "active" : "upcoming";

  const doc: Omit<Election, "_id"> = {
    electionType,
    state,
    countryId,
    seatId: getSeatIdFromElection({ countryId, electionType, state, senateClass, chamberClass }),
    cycle: spawn.cycle,
    electionYear: electionToLarpYear(
      electionType,
      spawn.cycle,
      senateClass,
      chamberClass,
      ctx,
      countryId
    ),
    status,
    totalSeats: prev?.totalSeats ?? fallbackTotalSeats,
    startTime,
    primaryEndTime,
    endTime,
    startTurn,
    primaryEndTurn: spawn.primaryEndTurn,
    endTurn: spawn.endTurn,
    durationHours: dur.durationHours,
    primaryDurationHours: dur.durationHours - dur.generalDurationHours,
    // Rules freeze: the race keeps the ruleset it opened under for its whole
    // cycle, so mid-race deploys cannot change how it counts.
    ...(electionType === "president"
      ? { rulesetVersion: CURRENT_PRESIDENTIAL_RULESET_VERSION }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
  if (senateClass) (doc as Election).senateClass = senateClass;
  if (chamberClass) (doc as Election).chamberClass = chamberClass;
  return doc;
}

/**
 * Heal `totalSeats` on live US House races after a decennial reapportionment
 * (ticket #1190).
 *
 * `runCensus` rewrites `state.houseDistricts` and regenerates the affected
 * `congressionalDistricts` maps, but nothing carried the new apportionment onto
 * the Election docs. `buildCanonicalSpawn` inherits `prev?.totalSeats`, so a
 * stale count propagates forward indefinitely, and a race already in flight when
 * the census fires is never corrected at all. The two then disagree about the
 * size of the same delegation: `districtedHouseResolution` allocates over the
 * NEW district map while every display surface reads the OLD `totalSeats`. On
 * the live 1953 world the 1960 census moved 21 states — Alabama 9 → 8 — and its
 * in-flight race rendered "You are projected 7 of 9 seats" with an unfillable
 * ninth block, while the delegation resolved to 8 members and the House to 434.
 *
 * Same pattern, and the same reason, as the Commons heal in
 * {@link ensureUKElections}: without it projections keep reading the wrong
 * `totalSeats` until the next cycle even though allocation is already
 * apportionment-aware.
 *
 * `houseSeats` must be the LIVE apportionment (`loadApportionment`), not the
 * frozen preset map — the census is exactly what moves them apart.
 */
export function buildHouseSeatHealOps(
  liveElections: Pick<Election, "_id" | "electionType" | "countryId" | "state" | "totalSeats">[],
  houseSeats: Record<string, number>,
  now: Date
): AnyBulkWriteOperation<Election>[] {
  return liveElections.flatMap((e) => {
    // NG zone races share electionType "house" with their own seat counts, so
    // the country gate is load-bearing, not defensive.
    if (e.electionType !== "house" || e.countryId !== "US" || !e.state) return [];
    const expected = houseSeats[e.state];
    // A state absent from the apportionment map (an unadmitted territory) or
    // reading non-positive must be left alone rather than zeroed.
    if (typeof expected !== "number" || expected <= 0 || e.totalSeats === expected) return [];
    return [
      {
        updateOne: {
          filter: { _id: e._id },
          update: { $set: { totalSeats: expected, updatedAt: now } },
        },
      },
    ];
  });
}

/**
 * Safety net: ensure every US state has an active/upcoming election for each
 * perpetual race type (house, senate class slots, governor, stateSenate) and
 * that the national president race exists in the canonical window.
 *
 * All spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. Admin-accelerated prior cycles do NOT drag
 * the calendar — the next cycle stays on the real-world election year. A
 * 24h+24h primary/general gate skips any canonical cycle that would produce
 * a stub race (admin fast-forwarded prev deep enough that the next canonical
 * window has already eroded).
 *
 * Status is "active" when the canonical startTurn has passed, else "upcoming";
 * `advanceElectionTimers` flips upcoming → active at startTime.
 *
 * Runs after resolveGeneralElections every turn — fills gaps, never duplicates.
 */
export async function ensurePerpetualElections(now: Date, currentTurn?: number): Promise<void> {
  const db = await getDb();

  // First, clean up any duplicate active/upcoming elections
  await cleanupDuplicateElections(db);

  // Canonical LARP anchoring requires currentTurn + preset ctx. Explicit
  // param wins for the turn; ctx always comes from gameState.
  const { currentTurn: gsTurn, currentYear, ctx } = await getCurrentTurnAndCtx(db);
  const resolvedTurn = currentTurn ?? gsTurn;

  // Scope perpetual elections to US-only regions.
  // UK constituencies run under different electoral rules (see ensureUKElections).
  const states = await db
    .collection<State>("states")
    .find(US_STATE_FILTER, { projection: { _id: 1, admittedYear: 1, stateSenateSeats: 1 } })
    .toArray();
  // Seat counts for the stateSenate spawn below; avoids a per-state findOne
  // round-trip inside the state loop (N+1 across ~50 states per turn).
  const stateSenateSeatsById = new Map<string, number | undefined>(
    states.map((s) => [s._id as string, (s as State).stateSenateSeats])
  );
  // Only full electoral states get perpetual House/Senate/Governor/stateSenate
  // races, and only those the ACTIVE preset apportions.
  //
  // Two exclusions, both required:
  //  1. `isUsElectoralState` — federal districts like DC live in `states` for
  //     economy/presidential electoral votes but elect none of these seats.
  //  2. Absence from the preset's House apportionment map — a pre-statehood
  //     territory in this era (Alaska/Hawaii under 1953-default, which uses the
  //     1950 census; they were territories until 1959). `isUsElectoralState` is
  //     preset-INDEPENDENT (the modern 50-state set), so on its own it spawns
  //     perpetual races for regions `seedSeats` correctly gives no seat, and
  //     those orphan elections regenerate after every reset. `seedSeats.ts`
  //     applies exactly this gate and, per its comment, a state absent from the
  //     era map "elects no House member, Senators, Governor or State Senate" —
  //     so the gate covers all four families here, not just house.
  //
  // The preset map is frozen, so exclusion (2) is permanent on its own. A
  // territory admitted mid-game carries `admittedYear` and joins the roster
  // here — which is the whole mechanism by which a new state gets elections:
  // this pass already spawns any missing House/Senate/Governor/stateSenate race
  // on the canonical schedule, so no separate election-bootstrapping path is
  // needed for it.
  const presetHouseSeats = getHouseSeats(ctx.preset);
  const admittedIds = new Set(admittedStateIdsAsOf(states, currentYear));
  const stateIds = states
    .map((s) => s._id as string)
    .filter(
      (id) => isUsElectoralState(id) && (presetHouseSeats[id] != null || admittedIds.has(id))
    );
  const fullStateIds = new Set(stateIds);
  // Alaska and Hawaii are playable territories before statehood. They retain
  // the normal governor race machinery but no federal or state-legislative
  // elections until admission moves them into `stateIds` above.
  const territorialGovernorStateIds = states
    .map((s) => s._id as string)
    .filter(
      (id) =>
        !fullStateIds.has(id) && TERRITORY_ADMISSIONS.some((territory) => territory.stateId === id)
    );

  // Existing worlds predate territorial governor seat seeding. Upsert the
  // deterministic rows here so deployment heals them on the next turn, while
  // bootstrap/reset gets the same rows from `seedSeats`.
  if (territorialGovernorStateIds.length > 0) {
    const territorySeats = territorialGovernorStateIds.map((stateId) =>
      buildUsTerritorialGovernorSeat(stateId, now)
    );
    await db.collection<Seat>("seats").bulkWrite(
      territorySeats.map((seat) => {
        const { _id, ...body } = seat;
        return {
          updateOne: {
            filter: { _id },
            update: { $setOnInsert: body },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
  }

  const liveElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["active", "upcoming"] } })
    .toArray();

  const liveHouse = new Set(
    liveElections.filter((e) => e.electionType === "house").map((e) => e.state)
  );
  const liveGov = new Set(
    liveElections.filter((e) => e.electionType === "governor").map((e) => e.state)
  );
  const liveSenate = new Set(
    liveElections
      .filter((e) => e.electionType === "senate")
      .map((e) => `${e.state}_${e.senateClass}`)
  );
  const liveStateSen = new Set(
    liveElections.filter((e) => e.electionType === "stateSenate").map((e) => e.state)
  );
  // Scope to US: a concurrent-general country (e.g. NG) can hold its own active
  // `president` election. Without the country guard, NG's live president would
  // trip this gate and suppress the US presidential cycle indefinitely.
  const livePresident = liveElections.some(
    (e) => e.electionType === "president" && (e.countryId ?? "US") === "US"
  );

  const completedElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["completed", "resolved"] } })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(filter: (e: Election) => boolean): Election | undefined {
    return completedElections.find(filter);
  }

  // Bootstrap: if no state has ever completed a governor election, we still spawn one per state so governor races exist
  const anyStateHasCompletedGovernor = completedElections.some(
    (e) => e.electionType === "governor"
  );
  // Bootstrap: if no state has ever completed a stateSenate election, we still spawn one per state so state senate races exist
  const anyStateHasCompletedStateSen = completedElections.some(
    (e) => e.electionType === "stateSenate"
  );
  // Bootstrap/recovery: if no state has ever completed a senate election, seed all classes.
  // Also used for per-class recovery (see below).
  const anyStateHasCompletedSenate = completedElections.some((e) => e.electionType === "senate");

  const toInsert: Omit<Election, "_id">[] = [];

  // Live (census-updated) House apportionment for fallback delegation sizes
  // (P1d-2); equals the preset seed until a decennial census reapportions.
  //
  // `currentYear` is load-bearing: without it the admitted-state set is built as
  // of the PRESET year, and a state admitted mid-game is absent from that set by
  // definition — so it drops out of `houseSeats` entirely. It would then fall to
  // the 1-seat backstop below and, worse, be invisible to the census heal, which
  // skips states the map does not carry. `stateIds` above already gates
  // admission on `currentYear`, so passing it keeps the two in agreement.
  const { houseSeats: liveHouseSeats } = await loadApportionment(db, ctx.preset, currentYear);

  // A census between cycles leaves live races sized to the OLD apportionment
  // (#1190). Correct them before anything reads `totalSeats` this turn.
  const houseSeatHealOps = buildHouseSeatHealOps(liveElections, liveHouseSeats, now);
  if (houseSeatHealOps.length > 0) {
    await db.collection<Election>("elections").bulkWrite(houseSeatHealOps);
    console.log(
      `[Turn] ensurePerpetualElections: healed totalSeats on ${houseSeatHealOps.length} live US House race(s)`
    );
  }

  for (const stateId of stateIds) {
    // ── House (always perpetual) ─────────────────────────────────────────────
    if (!liveHouse.has(stateId)) {
      const prev = lastCompleted((e) => e.electionType === "house" && e.state === stateId);
      const doc = buildCanonicalSpawn({
        electionType: "house",
        countryId: "US",
        state: stateId,
        prev,
        currentTurn: resolvedTurn,
        now,
        fallbackTotalSeats: liveHouseSeats[stateId] ?? 1,
        ctx,
      });
      if (doc) {
        // `buildCanonicalSpawn` inherits `prev?.totalSeats`, so the fallback
        // alone cannot resize a delegation after a census — the prior cycle
        // always wins. A state's House size is whatever the live apportionment
        // says today, so force it (same reason as the NG force-heal below).
        const apportioned = liveHouseSeats[stateId];
        if (apportioned && apportioned > 0) doc.totalSeats = apportioned;
        toInsert.push(doc);
      }
    }

    // ── Senate (only the 2 classes that belong to this state) ────────────────
    const stateClasses = (SENATE_CLASSES[stateId] ?? [1, 2]) as [1 | 2 | 3, 1 | 2 | 3];
    for (const cls of stateClasses) {
      const key = `${stateId}_${cls}`;
      if (liveSenate.has(key)) continue;

      const hadCompleted = completedElections.some(
        (e) => e.electionType === "senate" && e.state === stateId && e.senateClass === cls
      );

      if (!hadCompleted) {
        // Never ran this class. Allow spawn in three scenarios:
        //   (a) Bootstrap: no state has ever completed any senate race (initial seed)
        //   (b) Recovery: this state has other senate elections (completed or live) but
        //       this class is missing — re-seed it so the stagger doesn't permanently drop out
        //   (c) Per-state init: a state in SENATE_CLASSES has no senate history at all
        //       (e.g. admin-added a new state mid-game). Seed every class it owns so the
        //       state actually gets senators rather than being silently skipped because
        //       other states have already completed senate elections.
        const isBootstrap = !anyStateHasCompletedSenate;
        const stateHasSomeSenate =
          completedElections.some((e) => e.electionType === "senate" && e.state === stateId) ||
          liveElections.some((e) => e.electionType === "senate" && e.state === stateId);
        const stateInRoster = stateId in SENATE_CLASSES;
        const isPerStateInit = !isBootstrap && !stateHasSomeSenate && stateInRoster;
        if (!isBootstrap && !stateHasSomeSenate && !isPerStateInit) continue;
        if (!isBootstrap && stateHasSomeSenate) {
          console.warn(
            `[Turn] ensurePerpetualElections: senate class ${cls} missing for ${stateId} — re-seeding for recovery`
          );
        } else if (isPerStateInit) {
          console.warn(
            `[Turn] ensurePerpetualElections: no senate history for ${stateId} — seeding initial classes (per-state init)`
          );
        }
      }
      const prev = lastCompleted(
        (e) => e.electionType === "senate" && e.state === stateId && e.senateClass === cls
      );
      const doc = buildCanonicalSpawn({
        electionType: "senate",
        countryId: "US",
        state: stateId,
        senateClass: cls,
        prev,
        currentTurn: resolvedTurn,
        now,
        fallbackTotalSeats: 1,
        ctx,
      });
      if (doc) toInsert.push(doc);
    }

    // ── Governor ─────────────────────────────────────────────────────────────
    const hadGov = completedElections.some(
      (e) => e.electionType === "governor" && e.state === stateId
    );
    const needGov = !liveGov.has(stateId) && (hadGov || !anyStateHasCompletedGovernor);
    if (needGov) {
      const prev = lastCompleted((e) => e.electionType === "governor" && e.state === stateId);
      const doc = buildCanonicalSpawn({
        electionType: "governor",
        countryId: "US",
        state: stateId,
        prev,
        currentTurn: resolvedTurn,
        now,
        fallbackTotalSeats: 1,
        ctx,
      });
      if (doc) toInsert.push(doc);
    }

    // ── State Senate ─────────────────────────────────────────────────────────
    const hadStateSen = completedElections.some(
      (e) => e.electionType === "stateSenate" && e.state === stateId
    );
    const needStateSen =
      !liveStateSen.has(stateId) && (hadStateSen || !anyStateHasCompletedStateSen);
    if (needStateSen) {
      const prev = lastCompleted((e) => e.electionType === "stateSenate" && e.state === stateId);
      // US-only stateSenate spawn path (stateIds is already US_STATE_FILTER-scoped).
      const fallbackTotalSeats = stateSenateSeatsById.get(stateId) ?? 40;
      const doc = buildCanonicalSpawn({
        electionType: "stateSenate",
        countryId: "US",
        state: stateId,
        prev,
        currentTurn: resolvedTurn,
        now,
        fallbackTotalSeats,
        ctx,
      });
      if (doc) toInsert.push(doc);
    }
  }

  // ── Territorial governors (AK/HI before admission) ───────────────────────
  for (const stateId of territorialGovernorStateIds) {
    if (liveGov.has(stateId)) continue;
    const prev = lastCompleted((e) => e.electionType === "governor" && e.state === stateId);
    const doc = buildCanonicalSpawn({
      electionType: "governor",
      countryId: "US",
      state: stateId,
      prev,
      currentTurn: resolvedTurn,
      now,
      fallbackTotalSeats: 1,
      ctx,
    });
    if (doc) toInsert.push(doc);
  }

  // ── President (national, anchored to LARP presidential year) ───────────────
  // The canonical LARP window + 24h+24h gate ensures president only spawns in
  // valid windows — no separate year-guard needed.
  if (!livePresident) {
    const prev = lastCompleted(
      (e) => e.electionType === "president" && (e.countryId ?? "US") === "US"
    );
    const doc = buildCanonicalSpawn({
      electionType: "president",
      countryId: "US",
      state: "US",
      prev,
      currentTurn: resolvedTurn,
      now,
      fallbackTotalSeats: 1,
      ctx,
    });
    if (doc) toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((electionDoc) => {
    const filter: Record<string, unknown> = {
      electionType: electionDoc.electionType,
      state: electionDoc.state,
      status: { $in: ["active", "upcoming"] },
    };
    if (
      electionDoc.electionType === "senate" &&
      "senateClass" in electionDoc &&
      electionDoc.senateClass
    ) {
      filter.senateClass = electionDoc.senateClass;
    }
    return filter;
  });

  const existing = await db
    .collection<Election>("elections")
    .find({ $or: orFilters }, { projection: { electionType: 1, state: 1, senateClass: 1 } })
    .toArray();

  const existingKey = (e: { electionType: string; state: string; senateClass?: number }) =>
    `${e.electionType}_${e.state}_${e.senateClass ?? ""}`;
  const existingSet = new Set(existing.map(existingKey));

  const toActuallyInsert = toInsert.filter((electionDoc) => {
    const key = existingKey({
      electionType: electionDoc.electionType,
      state: electionDoc.state,
      senateClass:
        electionDoc.electionType === "senate" && "senateClass" in electionDoc
          ? electionDoc.senateClass
          : undefined,
    });
    return !existingSet.has(key);
  });

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensurePerpetualElections: spawned ${toActuallyInsert.length} missing election(s)`
    );

    // Discord: notify about newly opened elections (batched by type)
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Withdraw any active candidates still attached to completed elections.
 * Safety net for pre-existing data and edge cases in the normal resolution path.
 */
export async function cleanupStaleElectionCandidates(now: Date): Promise<void> {
  const db = await getDb();

  const completedElectionIds = await db
    .collection<Election>("elections")
    .find({ status: "completed" }, { projection: { _id: 1 } })
    .toArray()
    .then((docs) => docs.map((d) => d._id));

  if (completedElectionIds.length === 0) return;

  const result = await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: { $in: completedElectionIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  if (result.modifiedCount > 0) {
    console.log(
      `[Turn] Cleaned up ${result.modifiedCount} stale candidate(s) from completed elections`
    );
  }
}

/**
 * Convert a prior election's wall-clock endTime to a LARP turn number. Used
 * for snap-shift anchoring — 1 turn = 1 real hour, so turnsAgo is the hour
 * delta between `endTime` and `nowRef` (which represents currentTurn).
 */
export function endTimeToLarpTurn(endTime: Date, nowRef: Date, currentTurn: number): number {
  const turnsAgo = Math.round((nowRef.getTime() - new Date(endTime).getTime()) / MS_PER_TURN);
  return currentTurn - turnsAgo;
}
