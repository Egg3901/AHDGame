import { AsyncLocalStorage } from "async_hooks";
import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCountryAccessFromDb, withCountryAccessSnapshot } from "@/lib/countryAccess";
import { NG_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import type { Election, ElectionStatus, GameState, State } from "@/lib/db/types";
import { UK_COMMONS_SEATS } from "@/lib/turn/electionResolution";
import { US_STATE_FILTER } from "@/lib/utils/electionLabels";
import { MS_PER_TURN, STARTING_YEAR } from "@/lib/constants/turnTime";
import {
  SENATE_CLASSES,
  UK_REGIONAL_COUNCIL_SEATS,
  getCnNpcSeats,
  getCnPeoplesCongressSeats,
} from "@/lib/constants";
import {
  JP_SHUGIIN_SEATS,
  JP_SANGIIN_SEATS,
  DE_WAHLKREIS_SEATS,
  getHouseSeats,
  isUsElectoralState,
} from "@/lib/constants/states";
import { loadApportionment } from "@/lib/elections/apportionment";
import { admittedStateIdsAsOf } from "@/lib/elections/statehoodAdmission";
import { type CountryId } from "@/lib/constants/countries";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { pickNextCanonicalCycle, turnToWallClock } from "@/lib/elections/canonicalCycle";

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
import {
  cycleAnchorContextFromGameState,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
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
import { generateLandeslistenForCycle } from "@/lib/elections/germanyLandesliste";

// Re-export so existing consumers (sync-date, snapElection, admin routes,
// etc.) that import DEFAULT_DURATIONS from this module keep working.
export { DEFAULT_DURATIONS };

function getGeneralWindow(electionType: string): number {
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

type TurnAndCtx = { currentTurn: number; currentYear: number; ctx: CycleAnchorContext };

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
const electionGameStateSnapshot = new AsyncLocalStorage<TurnAndCtx>();

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

async function readCurrentTurnAndCtx(
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
async function getCurrentTurnAndCtx(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>
): Promise<TurnAndCtx> {
  return electionGameStateSnapshot.getStore() ?? (await readCurrentTurnAndCtx(db));
}

/**
 * Send batched election announcement embeds to Discord.
 * Groups elections by type and status (upcoming vs active/primary open).
 */
async function sendBatchedElectionAnnouncements(
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
  resolvePrimaries: (now: Date) => Promise<void>
): Promise<void> {
  const db = await getDb();

  const elections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["active", "upcoming"] } })
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
async function cleanupDuplicateElections(
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
function buildCanonicalSpawn(params: {
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
    createdAt: now,
    updatedAt: now,
  };
  if (senateClass) (doc as Election).senateClass = senateClass;
  if (chamberClass) (doc as Election).chamberClass = chamberClass;
  return doc;
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
  const { houseSeats: liveHouseSeats } = await loadApportionment(db, ctx.preset);

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
      if (doc) toInsert.push(doc);
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
function endTimeToLarpTurn(endTime: Date, nowRef: Date, currentTurn: number): number {
  const turnsAgo = Math.round((nowRef.getTime() - new Date(endTime).getTime()) / MS_PER_TURN);
  return currentTurn - turnsAgo;
}

/**
 * Ensure every UK region has an active/upcoming Commons election.
 *
 * Spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. When the admin fast-forwards a regular
 * cycle via the "Modify Timers" PATCH, the next regular stays on calendar
 * (endTurn = 219 + (N − 1) × 240). Snap elections still shift the schedule
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
    // endTurn as its anchor. If prev is a regular (even an admin-accelerated
    // one), we deliberately DO NOT pass priorEndTurn — admin edits must not
    // drag the LARP calendar.
    const priorEndTurn =
      prev?.electionType === "snap_commons" && prev.endTime
        ? endTimeToLarpTurn(prev.endTime, now, currentTurn)
        : null;

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
      totalSeats: prev?.totalSeats ?? UK_COMMONS_SEATS[regionId] ?? 1,
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
 * Synchronized with the Commons cycle — when a live Commons race exists for
 * the region, the regional council mirrors its timestamps exactly so both
 * races resolve together. Otherwise falls back to canonical LARP scheduling
 * via {@link pickNextCanonicalCycle} with the same 24h+24h gate as Commons.
 * Regional council has no snap mechanic, so no priorEndTurn is passed.
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

  // Regional Council elections synchronize with Commons — match the existing
  // Commons election's timing for each region so they end on the same schedule.
  const liveCommonsElections = await db
    .collection<Election>("elections")
    .find({ electionType: "commons", status: { $in: ["active", "upcoming"] } })
    .toArray();
  const commonsByRegion = new Map(liveCommonsElections.map((e) => [e.state, e]));

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveCouncils.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Try to sync with the existing Commons election for this region
    const commonsElection = commonsByRegion.get(regionId);
    if (commonsElection?.startTime && commonsElection?.primaryEndTime && commonsElection?.endTime) {
      // Mirror the Commons election's timestamps exactly. During a pre-iteration
      // founding phase the mirrored Commons race is the cycle-0 founding race, so
      // the council must also be cycle 0 (else it spawns a stray cycle-1 that
      // never founds and blocks completion). Normal play: prev+1 as before.
      const councilCycle = ctx.preIterationActive ? 0 : (prev?.cycle ?? 0) + 1;
      toInsert.push({
        countryId: "UK",
        electionType: "regionalCouncil",
        state: regionId,
        seatId: getSeatIdFromElection({
          countryId: "UK",
          electionType: "regionalCouncil",
          state: regionId,
        }),
        cycle: councilCycle,
        electionYear: electionToLarpYear(
          "regionalCouncil",
          councilCycle,
          undefined,
          undefined,
          ctx
        ),
        status: commonsElection.status as "active" | "upcoming",
        totalSeats: prev?.totalSeats ?? UK_REGIONAL_COUNCIL_SEATS[regionId] ?? 1,
        startTime: commonsElection.startTime,
        primaryEndTime: commonsElection.primaryEndTime,
        endTime: commonsElection.endTime,
        startTurn: commonsElection.startTurn,
        primaryEndTurn: commonsElection.primaryEndTurn,
        endTurn: commonsElection.endTurn,
        durationHours: dur,
        primaryDurationHours: dur - genDur,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    // No Commons race to mirror — spawn independently on canonical LARP.
    const spawn = pickNextCanonicalCycle({
      electionType: "regionalCouncil",
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      ctx,
    });
    if (!spawn) continue;

    // Open the primary immediately (same rationale as Commons above) when there
    // is no live Commons race to mirror. The mirror path inherits the fix from
    // the Commons election it copies.
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
      electionYear: electionToLarpYear("regionalCouncil", spawn.cycle, undefined, undefined, ctx),
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
 * Ensure every JP region has an active or upcoming Shugiin election.
 *
 * Spawns anchor to the **canonical LARP schedule** via
 * {@link pickNextCanonicalCycle}. When the admin fast-forwards a regular
 * cycle via "Modify Timers", the next regular stays on calendar
 * (endTurn = 240 + (N − 1) × 192). Snap elections still shift the schedule
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

    // Snap shift: only when prev is a snap does the snap's endTurn anchor the
    // next regular's LARP schedule. Admin-accelerated regulars must NOT drag
    // the LARP calendar.
    const priorEndTurn =
      prev?.electionType === "snap_shugiin" && prev.endTime
        ? endTimeToLarpTurn(prev.endTime, now, currentTurn)
        : null;

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
    const priorEndTurn =
      prev?.electionType === "snap_bundestag" && prev.endTime
        ? endTimeToLarpTurn(prev.endTime, now, currentTurn)
        : null;

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
export {
  ensureDELandtagElections,
  ensureDEMinisterPresidentElections,
} from "@/lib/turn/election/germanyLandtag";

// ─── Shared regional multi-seat delegate spawner ─────────────────────────────

/**
 * Config for one country's per-region multi-seat delegate election family
 * (CN NPC Delegate / CN Provincial Congress / BR Câmara today; the three RU
 * Supreme Soviet families in Phase 3). Every field below is the ONLY thing
 * that differed between the previously-duplicated spawners.
 */
interface RegionalDelegateSpec {
  countryId: CountryId;
  /** electionType === officeType key (the CN convention). */
  electionType: string;
  /**
   * Per-region seat map computed from the full region list, so families that
   * apportion across regions can see every region at once. Simple families
   * return a constant map (CN, RU Nationalities) or derive per-doc
   * (RU Union: houseDistricts; RU republic soviets: stateSenateSeats).
   *
   * `preset` is the ACTIVE world preset (`ctx.preset`) so era-apportioned
   * families can size the race the way the seed and the country config do —
   * CN's chamber is 2,980 deputies in the modern eras but 1,226 in 1953 (#3779).
   */
  seatsForRegions: (regions: State[], preset: string | undefined) => Record<string, number>;
  /** Open the primary immediately (short window vs multi-year cycle). CN/BR: true. */
  openPrimaryImmediately: boolean;
  /**
   * No-op unless the runtime country status is beta/active. CN/BR are always
   * live and omit this; RU (coming-soon, per-game enabled) sets it in Phase 3.
   */
  statusGated?: boolean;
  /**
   * Liveness gate applied when `statusGated`. Defaults to
   * `countryElectionsLive` (strict beta/active). RU overrides it with
   * `ruElectionsLive` so its Supreme Soviet also runs under the NPP governing
   * brain while RU itself stays `coming-soon` and never player-enabled (#3386).
   */
  electionsLiveGate?: (db: Db, countryId: CountryId) => Promise<boolean>;
  /** Human label for the log line + announcements, e.g. "NPC Delegate", "Câmara". */
  label: string;
}

/**
 * Ensure every region of `spec.countryId` has an active/upcoming election of
 * `spec.electionType`. Canonical LARP scheduling via `buildCanonicalSpawn` —
 * no snap elections, no staggered classes. Extracted from the formerly-
 * duplicated ensureCNElections / ensureCNPeoplesCongressElections /
 * ensureBRElections bodies.
 */
async function ensureRegionalDelegateElections(
  spec: RegionalDelegateSpec,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (spec.statusGated) {
    const gate = spec.electionsLiveGate ?? countryElectionsLive;
    if (!(await gate(db, spec.countryId))) return;
  }
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find(
      { countryId: spec.countryId },
      { projection: { _id: 1, houseDistricts: 1, stateSenateSeats: 1 } }
    )
    .toArray();
  if (regions.length === 0) return;
  const seatMap = spec.seatsForRegions(regions as State[], ctx.preset);

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: spec.countryId,
      electionType: spec.electionType,
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveStates = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: spec.countryId,
      electionType: spec.electionType,
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const region of regions) {
    const regionId = region._id as string;
    if (liveStates.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const doc = buildCanonicalSpawn({
      electionType: spec.electionType,
      countryId: spec.countryId,
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatMap[regionId] ?? 1,
      ctx,
      openPrimaryImmediately: spec.openPrimaryImmediately,
    });
    if (!doc) continue;

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: spec.electionType,
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
      `[Turn] ensureRegionalDelegateElections(${spec.countryId}/${spec.electionType}): spawned ${toActuallyInsert.length} missing ${spec.label} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── China: NPC Delegate elections ──────────────────────────────────────────

/**
 * Ensure every CN region has an active/upcoming NPC Delegate election.
 *
 * Simple canonical LARP scheduling — no snap elections, no staggered classes.
 * Each region gets one multi-seat election with all seats contested.
 * Uses `buildCanonicalSpawn` for cycle computation and timing.
 */
export async function ensureCNElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "CN",
      electionType: "npcDelegate",
      // Authoritative per-region NPC seat count (was `1`, which would collapse
      // the first cycle to one seat per region). Era-gated: a 1953 world seats
      // the 1,226-deputy 1st NPC, not the modern 2,980 (#3779).
      seatsForRegions: (_regions, preset) => getCnNpcSeats(preset),
      openPrimaryImmediately: true,
      label: "NPC Delegate",
    },
    now
  );
}

// ─── Brazil: Chamber of Deputies + Senate ───────────────────────────────────

/**
 * Ensure every BR macro-region has an active/upcoming Câmara dos Deputados
 * election. Mirrors `ensureCNElections` — one multi-seat regional election
 * per region, anchored to the preset's `brChamber` cycle anchor.
 */
export async function ensureBRElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "BR",
      electionType: "chamber",
      seatsForRegions: (regions) => Object.fromEntries(regions.map((r) => [r._id as string, 1])),
      openPrimaryImmediately: true,
      label: "Câmara",
    },
    now
  );
}

/**
 * Ensure every BR macro-region has an active/upcoming Federal Senate
 * election. Had NO spawner at all before this — the seeded 81-seat chamber
 * (`brRegions[*].stateSenateSeats`, summing to 81 across the 5 macro-regions
 * — 21/27/12/12/9) never held a single election; seats only ever vacated
 * (resignation/term-end) with nothing to backfill them, so occupancy
 * strictly declined turn over turn.
 *
 * Mirrors `ensureBRElections`: one multi-seat regional election per
 * macro-region, sized by the region's own `stateSenateSeats` (same field NG's
 * multi-seat Senate spawner reads — `ensureNGZoneElections`), anchored to the
 * preset's `brSenate` cycle anchor (see `canonicalCycle.ts`'s `case "senate"`
 * BR branch and `BR_SENATE_CYCLE_PERIOD_HOURS` for the staggering-
 * simplification note: the real chamber renews 1/3 then 2/3 of individual
 * SEATS every 4 years; this elects every seat in a region together every 4
 * years instead, for lack of per-seat class data at the seed layer).
 */
export async function ensureBRSenateElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "BR",
      electionType: "senate",
      seatsForRegions: (regions) =>
        Object.fromEntries(
          regions.map((r) => [r._id as string, (r as State).stateSenateSeats ?? 1])
        ),
      openPrimaryImmediately: true,
      label: "Senate",
    },
    now
  );
}

// ─── Soviet Union: Supreme Soviet + republic soviets + First Secretaries ─────
//
// All four families are status-gated via `ruElectionsLive` (#3386): RU stays
// `coming-soon` for players, but its elections run when RU is beta/active (the
// Cold-War presets / the headless sim force this) OR when RU is NPP-governed
// (global autonomy ≥ v1, RU read-only, never player-enabled) — so a live world
// running the NPP brain re-elects the Supreme Soviet instead of freezing it.
// They are ALSO era-gated (null ruSupremeSoviet/ruRepublicSoviet anchors under
// 2019/1991 return no spawn from buildCanonicalSpawn).

/** Soviet of the Union — seats per region = the live region doc's houseDistricts. */
export async function ensureRUSupremeSovietElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "supremeSovietDeputy",
      seatsForRegions: (regions) =>
        Object.fromEntries(regions.map((r) => [r._id as string, r.houseDistricts ?? 1])),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Supreme Soviet",
    },
    now
  );
}

/** Soviet of Nationalities — republic-weighted D11 map, same-day as the Union. */
export async function ensureRUNationalitiesElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "nationalitiesDeputy",
      seatsForRegions: () => RU_NATIONALITIES_SEATS,
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Nationalities",
    },
    now
  );
}

/**
 * Republic Supreme Soviets — each region's own authored chamber size
 * (`stateSenateSeats` on the seeded State doc, the realistic per-republic
 * Supreme Soviet sizes from the map seed). Reading the live doc keeps the
 * election totals, the admin seat panel, and state-bill passage thresholds
 * on one source of truth (amended D11 — user decision 2026-07-20).
 */
export async function ensureRURepublicSovietElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "RU",
      electionType: "republicSupremeSoviet",
      seatsForRegions: (regions) =>
        Object.fromEntries(regions.map((r) => [r._id as string, r.stateSenateSeats ?? 1])),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ruElectionsLive,
      label: "Republic Soviet",
    },
    now
  );
}

/**
 * Republic First Secretaries — the shared governor family with the D10 anchor
 * override (ruRepublicSoviet, threaded via countryId). The shared helper has
 * no status gate, so the RU wrapper adds it (the NG pattern).
 */
export async function ensureRUGovernorElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ruElectionsLive(db))) return;
  await ensureRegionalGovernorElections("RU", now);
}

// ─── East Germany: Volkskammer ──────────────────────────────────────────────

/**
 * DD Volkskammer — the GDR's unicameral chamber, elected as a single National
 * Front list per macro-region (1953) / Land (1979). One multi-seat regional
 * delegate election per region, seats from the live `houseDistricts` (sum = 500).
 * Mirrors `ensureRUSupremeSovietElections` — the sibling one-party command state.
 */
export async function ensureDDVolkskammerElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "DD",
      electionType: "volkskammerDeputy",
      seatsForRegions: (regions) =>
        Object.fromEntries(regions.map((r) => [r._id as string, r.houseDistricts ?? 1])),
      openPrimaryImmediately: true,
      statusGated: true,
      label: "Volkskammer",
    },
    now
  );
}

/**
 * Status/NPP-governed gate for DD election families (the RU shape): live when
 * the country is beta/active, or when an NPP brain governs a coming-soon DD so
 * its chamber re-elects instead of freezing.
 */
async function ddElectionsLive(db: Db): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, "DD");
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

/**
 * Land First Secretaries — the shared governor family with the Volkskammer
 * anchor override (threaded via countryId in canonicalCycle, mirroring RU's
 * republic-soviet ride-along). The shared helper has no status gate, so the
 * DD wrapper adds it (the RU pattern).
 */
export async function ensureDDGovernorElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ddElectionsLive(db))) return;
  await ensureRegionalGovernorElections("DD", now);
}

/**
 * Land assemblies (Landtage) — each Land's authored chamber size
 * (`stateSenateSeats` on the seeded State doc). Without this family, Land
 * First Secretaries have no same-party legislature NPPs to queue state bills
 * through (ticket #1044). Mirrors `ensureRURepublicSovietElections`.
 */
export async function ensureDDLandAssemblyElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "DD",
      electionType: "landAssembly",
      seatsForRegions: (regions) =>
        Object.fromEntries(regions.map((r) => [r._id as string, r.stateSenateSeats ?? 1])),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ddElectionsLive,
      label: "Landtag",
    },
    now
  );
}

/**
 * Eastern-bloc NPP/beta election gate (DD/RU shape): live when the country is
 * beta/active, or when an NPP brain governs a coming-soon economy-preview row
 * so the assembly re-elects instead of freezing.
 */
async function easternBlocElectionsLive(db: Db, countryId: CountryId): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, countryId);
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

async function ensureEasternBlocAssemblyElections(
  countryId: CountryId,
  electionType: string,
  label: string,
  now: Date
): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId,
      electionType,
      seatsForRegions: (regions) =>
        Object.fromEntries(regions.map((r) => [r._id as string, r.houseDistricts ?? 1])),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label,
    },
    now
  );
}

/** Poland Sejm — unicameral one-party assembly (DD regional-delegate pattern). */
export async function ensurePLElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("PL", "sejm", "Sejm", now);
}

/** Czechoslovakia Chamber of the People. */
export async function ensureCSElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "CS",
    "chamberOfThePeople",
    "Chamber of the People",
    now
  );
}

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("HU", "nationalAssembly", "National Assembly", now);
}

/** Romania Grand National Assembly. */
export async function ensureROElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "RO",
    "grandNationalAssembly",
    "Grand National Assembly",
    now
  );
}

/** Bulgaria National Assembly. */
export async function ensureBGElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BG", "nationalAssembly", "National Assembly", now);
}

/** Yugoslavia Federal Assembly. */
export async function ensureYUElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("YU", "federalAssembly", "Federal Assembly", now);
}

// ─── Union republics: republican Supreme Soviets ────────────────────────────
//
// Mechanically these are the satellites' shape - one multi-seat single-list
// delegate election per region, seats from the live `houseDistricts` - but they
// ride a DIFFERENT canonical anchor. The "supremeSoviet" electionType maps to
// `ruRepublicSoviet` (1955 / 1980) rather than the satellites' `ddVolkskammer`,
// because the republican soviets were elected on the all-Union republic cycle,
// not on each satellite's own national schedule. Using the satellite anchor
// would have Kyiv going to the polls on the GDR's calendar.
//
// The RU regional-delegate path is the closer relative and is why this uses the
// shared assembly helper rather than a bespoke one: `ensureRURepublicSovietElections`
// does the same job for the republics RU still owns as regions.

/** Ukrainian SSR Supreme Soviet (435 deputies). */
export async function ensureUKRElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("UKR", "supremeSoviet", "Supreme Soviet", now);
}

/** Byelorussian SSR Supreme Soviet (360 deputies). */
export async function ensureBLRElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BLR", "supremeSoviet", "Supreme Soviet", now);
}

/** Baltic republican Supreme Soviets, modelled as one 300-seat chamber. */
export async function ensureBALElections(now: Date): Promise<void> {
  await ensureEasternBlocAssemblyElections("BAL", "supremeSoviet", "Supreme Soviet", now);
}

// ─── Nigeria: House of Representatives ──────────────────────────────────────

/**
 * Ensure every NG geopolitical zone has an active/upcoming House of
 * Representatives election. Mirrors `ensureBRElections` — one multi-seat
 * regional election per zone, anchored to the canonical `house` cycle.
 */
export async function ensureNGElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Each NG zone is a multi-seat House election sized by its houseDistricts
  // (95/50/53/72/47/43 = 360). Without this the spawn fell back to totalSeats=1,
  // so the whole chamber projected/resolved as 6 single-winner races (#901).
  const seatsByRegion = new Map<string, number>(
    ngRegions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "house",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "house",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const doc = buildCanonicalSpawn({
      electionType: "house",
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (!doc) continue;

    // buildCanonicalSpawn inherits prev?.totalSeats, and NG's earlier cycles were
    // spawned with the buggy totalSeats=1 — so the fallback alone wouldn't heal
    // future cycles. A zone's House seat count is the fixed authoritative
    // houseDistricts, so force it here so every new cycle sizes correctly (#901).
    const authoritativeSeats = seatsByRegion.get(regionId);
    if (authoritativeSeats && authoritativeSeats > 0) {
      doc.totalSeats = authoritativeSeats;
    }

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "house" as const,
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
      `[Turn] ensureNGElections: spawned ${toActuallyInsert.length} missing House election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Per-zone NG elections for a non-House office (Senate or Governor). Mirrors
 * `ensureNGElections`; the seat docs (seedSeats) carry the per-zone seat counts,
 * so `fallbackTotalSeats` is only a backstop.
 */
async function ensureNGZoneElections(
  now: Date,
  electionType: "senate" | "governor"
): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Senate is multi-seat per zone (stateSenateSeats: 18-21, summing to 109);
  // Governor is a single seat. Without sizing the Senate by stateSenateSeats the
  // spawn fell back to totalSeats=1 and each zone seated only 1 senator (NG).
  const seatsByRegion = new Map<string, number>(
    ngRegions.map((r) => [
      r._id as string,
      electionType === "senate" ? ((r as State).stateSenateSeats ?? 1) : 1,
    ])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", electionType, status: { $in: ["active", "upcoming"] } })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", electionType, status: { $in: ["completed", "resolved"] } })
    .sort({ updatedAt: -1 })
    .toArray();

  const lastCompleted = (regionId: string): Election | undefined =>
    completedElections.find((e) => e.state === regionId);

  const toInsert: Omit<Election, "_id">[] = [];
  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;
    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
    const doc = buildCanonicalSpawn({
      electionType,
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (doc) {
      // buildCanonicalSpawn inherits prev?.totalSeats, and NG's earlier senate
      // cycles were spawned with the buggy totalSeats=1 — force the authoritative
      // zone seat count so new cycles size correctly and self-heal (NG senate).
      const authoritativeSeats = seatsByRegion.get(regionId);
      if (authoritativeSeats && authoritativeSeats > 1) doc.totalSeats = authoritativeSeats;
      toInsert.push(doc);
    }
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
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
      `[Turn] ensureNG${electionType === "senate" ? "Senate" : "Governor"}Elections: spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

export async function ensureNGSenateElections(now: Date): Promise<void> {
  await ensureNGZoneElections(now, "senate");
}

export async function ensureNGGovernorElections(now: Date): Promise<void> {
  await ensureNGZoneElections(now, "governor");
}

/**
 * Ensure every NG zone has an active/upcoming State House of Assembly
 * (regionalCouncil) election. Mirrors ensureNGElections; per-zone multi-seat,
 * anchored to the concurrent general cycle. Seats from NG_REGIONAL_COUNCIL_SEATS.
 */
export async function ensureNGRegionalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ngRegions = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ngRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "regionalCouncil",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "regionalCouncil",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const lastCompleted = (regionId: string): Election | undefined =>
    completedElections.find((e) => e.state === regionId);

  const toInsert: Omit<Election, "_id">[] = [];
  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;
    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
    const doc = buildCanonicalSpawn({
      electionType: "regionalCouncil",
      countryId: "NG",
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: NG_REGIONAL_COUNCIL_SEATS[regionId] ?? 1,
      ctx,
      openPrimaryImmediately: true,
    });
    if (doc) toInsert.push(doc);
  }
  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "regionalCouncil" as const,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId: "NG", $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));
  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureNGRegionalCouncilElections: spawned ${toActuallyInsert.length} Assembly election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * National NG presidential race. Resolution uses the bespoke
 * `nigeriaPresidentialElectionEngine` (national popular vote + federal-character
 * spread + run-off). Gated until NG is activated.
 */
export async function ensureNGPresidentialElection(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ngElectionsLive(db))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const live = await db.collection<Election>("elections").findOne({
    countryId: "NG",
    electionType: "president",
    status: { $in: ["active", "upcoming"] },
  });
  if (live) return;

  const prev = await db
    .collection<Election>("elections")
    .find({
      countryId: "NG",
      electionType: "president",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .limit(1)
    .next();
  if (justResolvedInSameTurn(prev ?? undefined, now, currentTurn)) return;

  const doc = buildCanonicalSpawn({
    electionType: "president",
    countryId: "NG",
    state: "NG",
    prev: prev ?? undefined,
    currentTurn,
    now,
    fallbackTotalSeats: 1,
    ctx,
    openPrimaryImmediately: true,
  });
  if (!doc) return;

  await db.collection<Election>("elections").insertOne(doc as Election);
  console.log("[Turn] ensureNGPresidentialElection: spawned NG presidential race");
  sendBatchedElectionAnnouncements([doc], now);
}

// ─── Ireland: Dáil Éireann ──────────────────────────────────────────────────

/**
 * Clone a live peer race's timing for a region that joined mid-cycle (NI
 * reunifying into Ireland), so the newcomer's race resolves on the SAME schedule
 * as the rest of the country instead of opening its own canonical cycle. Mirrors
 * the Commons→regionalCouncil sync in {@link ensureUKRegionalCouncilElections}.
 */
function mirrorPeerRaceTiming(
  countryId: CountryId,
  peer: Election,
  state: string,
  electionType: string,
  totalSeats: number,
  now: Date
): Omit<Election, "_id"> {
  return {
    countryId,
    electionType,
    state,
    seatId: getSeatIdFromElection({ countryId, electionType, state }),
    cycle: peer.cycle,
    electionYear: peer.electionYear,
    status: peer.status === "upcoming" ? "upcoming" : "active",
    totalSeats,
    startTime: peer.startTime,
    primaryEndTime: peer.primaryEndTime,
    endTime: peer.endTime,
    startTurn: peer.startTurn,
    primaryEndTurn: peer.primaryEndTurn,
    endTurn: peer.endTurn,
    durationHours: peer.durationHours,
    primaryDurationHours: peer.primaryDurationHours,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Ensure every IE region has an active/upcoming Dáil Éireann election.
 * Mirrors `ensureCNElections` — one multi-seat constituency election per
 * region, anchored to the preset's `ieDail` cycle anchor. A region that joins
 * mid-cycle (NI reunifying) syncs to the live Republic race instead.
 */
export async function ensureIEElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ieRegions = await db
    .collection<State>("states")
    .find({ countryId: "IE" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = ieRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  // Per-region Dáil magnitude (PR-STV multi-seat constituencies). Sourced from
  // the seeded State doc so it tracks the world's preset (1991 vs 2019) without
  // a hardcoded map. Falls back to 1 only if a region is missing the field.
  const seatsByRegion = new Map<string, number>(
    ieRegions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "dail",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "dail",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // A region with no prior Dáil race that joins while the rest of Ireland is
    // mid-cycle (NI reunifying) syncs to the live Republic race so they resolve
    // together; otherwise spawn its own canonical cycle.
    const peer = !prev ? liveElections[0] : undefined;
    const doc = peer
      ? mirrorPeerRaceTiming("IE", peer, regionId, "dail", seatsByRegion.get(regionId) ?? 1, now)
      : buildCanonicalSpawn({
          electionType: "dail",
          countryId: "IE",
          state: regionId,
          prev,
          currentTurn,
          now,
          fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
          ctx,
          openPrimaryImmediately: true,
        });
    if (!doc) continue;

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType: "dail" as const,
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
      `[Turn] ensureIEElections: spawned ${toActuallyInsert.length} missing Dáil election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

// ─── Beta parliamentary countries: FR/IT/ES/SE/TR lower chambers (#3239) ────

/**
 * Runtime status gate for beta-country election spawners — same two-tier
 * DB-over-config source as {@link ngElectionsLive}: flipping the admin status
 * to "beta"/"active" turns the country's cycle on with no redeploy, and a
 * coming-soon country never spawns NPC elections on the live world. Explicit
 * allow-list so an unexpected status never silently enables spawning.
 */
async function countryElectionsLive(db: Db, countryId: CountryId): Promise<boolean> {
  const { status } = await getCountryAccessFromDb(db, countryId);
  return status === "beta" || status === "active";
}

/**
 * RU-specific election gate (#3386). RU is intentionally `coming-soon` — its
 * economy/UI/forex aren't launch-ready — so it must NOT be flipped to
 * beta/active just to un-freeze its legislature. But under the standard
 * `countryElectionsLive` gate a `coming-soon` RU spawns nothing, so the Supreme
 * Soviet seeded at bootstrap is never re-elected (frozen forever).
 *
 * Decouple the two: RU's Supreme Soviet / Nationalities / republic-soviet
 * families run when EITHER
 *   - RU is genuinely live (`beta`/`active`) — the eventual launch, and the
 *     headless sim harness, which forces `status: "active"` for scoped
 *     countries; OR
 *   - RU is NPP-governed (global NPP autonomy ≥ v1 and RU still NOT
 *     player-enabled). `nppGoverned` is false whenever `enabledForPlayers` is
 *     true, so this path surfaces RU's legislature READ-ONLY (the NPP governing
 *     brain runs the elections, per-action APIs still block office-taking) —
 *     it never flips RU to player-live.
 *
 * Scoped to RU on purpose: NG/FR/IT/ES/SE/TR keep the strict beta/active gate.
 */
async function ruElectionsLive(db: Db, _countryId: CountryId = "RU"): Promise<boolean> {
  const { status, nppGoverned } = await getCountryAccessFromDb(db, "RU");
  if (status === "beta" || status === "active") return true;
  return nppGoverned;
}

/**
 * Ensure every region of a beta parliamentary country (FR/IT/ES/SE/TR) has an
 * active/upcoming lower-chamber election. Modeled on `ensureIEElections`:
 * one multi-seat regional election per region (seats = the seeded State doc's
 * `houseDistricts`, so chamber size tracks the world's preset — e.g. SE 1953
 * seeds the 230-seat Second Chamber, the modern seed the 349-seat Riksdag),
 * anchored to the preset's cycle anchor via `BETA_PARLIAMENT_CYCLES` in
 * canonicalCycle.ts. Era-gated presets (ES 1953-default: Franco dictatorship)
 * have a `null` anchor, so `buildCanonicalSpawn` returns null and the country
 * stays static by design.
 *
 * Gated on the runtime country status (beta/active) like NG, so coming-soon
 * worlds are unaffected.
 */
async function ensureBetaParliamentElections(
  countryId: CountryId,
  electionType: string,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (!(await countryElectionsLive(db, countryId))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [r._id as string, (r as State).houseDistricts ?? 1])
  );

  // Include the country's snap type so a live snap suppresses regulars and a
  // resolved snap shifts the next regular's anchor (parity with UK/JP/DE).
  const snapType = `snap_${electionType}`;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: { $in: [electionType, snapType] },
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: { $in: [electionType, snapType] },
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // Snap shift: only a resolved snap drags the anchor (priorEndTurn +
    // period); admin-accelerated regulars must NOT move the LARP calendar.
    const priorEndTurn =
      prev?.electionType === snapType && prev.endTime
        ? endTimeToLarpTurn(prev.endTime, now, currentTurn)
        : null;

    const spawn = pickNextCanonicalCycle({
      electionType,
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn,
      ctx,
    });
    if (!spawn) continue; // era-gated (ES 1953) or gate exhausted

    // Open the primary immediately (mirrors IE/BR/UK): the multi-year cycle
    // far exceeds the 48h window, so the canonical startTurn would otherwise
    // leave a long "Opens in X turns" dead zone. `primaryEndTurn`/`endTurn`
    // stay canonical so the general lands on its real-world year.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType,
      state: regionId,
      seatId: getSeatIdFromElection({ countryId, electionType, state: regionId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(electionType, spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? seatsByRegion.get(regionId) ?? 1,
      startTime,
      primaryEndTime,
      endTime,
      startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur.durationHours,
      primaryDurationHours: dur.durationHours - dur.generalDurationHours,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureBetaParliamentElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/** FR Assemblée nationale spawner (5-year cycle; era-aware via preset anchors). */
export async function ensureFRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("FR", "assembleeNationale", now);
}

/** IT Camera dei Deputati spawner (5-year cycle). */
export async function ensureITElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("IT", "cameraDeputati", now);
}

/** ES Congreso de los Diputados spawner (4-year cycle; NO-OP in 1953-default — Franco era). */
export async function ensureESElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("ES", "congresoDiputados", now);
}

/** SE Riksdag spawner (4-year cycle; 1953 seed contests the 230-seat Second Chamber). */
export async function ensureSEElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("SE", "riksdag", now);
}

/** TR Grand National Assembly spawner (4-year cycle). */
export async function ensureTRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("TR", "milletMeclisi", now);
}

/**
 * GR / AT / FI lower chambers. These three used to be spawned from inside
 * `ensureTRElections`, which meant their elections only ran while Turkey's
 * phase ran and any failure or timing shift there was misattributed to TR.
 * They are unrelated countries and now own their COUNTRY_ELECTION_PHASES
 * entries. Spawning stays idempotent, so the split is behaviour-preserving
 * for a healthy TR phase and strictly more correct for an unhealthy one.
 */
export async function ensureGRElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("GR", "vouli", now);
}

export async function ensureATElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("AT", "nationalrat", now);
}

export async function ensureFIElections(now: Date): Promise<void> {
  await ensureBetaParliamentElections("FI", "eduskunta", now);
}

// ─── Beta parliamentary countries: upper chambers / Senates (#3791) ─────────

/**
 * Ensure every region of a beta-tier country's SENATE has an active/upcoming
 * election. Sibling to `ensureBetaParliamentElections` (lower chambers): same
 * per-region multi-seat spawn shape and gate (`countryElectionsLive`), but
 * seats are sourced from `state.stateSenateSeats` — NOT `houseDistricts`,
 * which is the LOWER chamber's seat map and is seeded independently (see
 * `seedEconTierRosters.ts`, which sources `r.stateSenateSeats` for exactly
 * this reason).
 *
 * Without this spawner a lapsed senator's seat is NEVER refilled: no
 * equivalent of `ensureBetaParliamentElections` exists for any Senate, so
 * every upper chamber in the game trends toward empty as terms lapse with
 * nothing re-electing them (measured: TR Senate 100% vacant, FR 52.5%, IT
 * 11.4% vacant at turn 654 of a 1953-default world).
 *
 * No snap-election handling — unlike the lower-chamber spawner there is no
 * existing snap-senate concept in this codebase, so this intentionally omits
 * the `snap_${electionType}` family the lower-chamber spawner includes.
 *
 * SIMPLIFICATIONS (real-world structure vs. what's modeled here):
 *  - FR Sénat: real senators serve staggered terms via indirect election by
 *    departmental electoral colleges — one-third (pre-2004) or one-half
 *    (2004+) of seats renewed every 3 years, 9-year term per senator. This
 *    spawner elects the WHOLE chamber at once every 9 years instead, matching
 *    the country's own `upperElectionSystem.seatsContested: "all"`
 *    declaration. There's no seat-series/class data model for FR (unlike the
 *    US Senate's `senateClass` mechanism), so partial renewal is not modeled.
 *  - IT Senato della Repubblica: directly elected. Senato and Camera have
 *    been elected on the SAME DAY for the Republic's entire history (both
 *    dissolve together) — this rides the itCamera anchor (see
 *    `canonicalTurnsForCycle`'s "senato" case), which is historically
 *    accurate, not a simplification.
 *  - TR Senate of the Republic (Cumhuriyet Senatosu, 1961-1980): historically
 *    one-third renewed every 2 years (6-year term per senator), and abolished
 *    after the 1980 coup. This spawner elects the whole chamber at once on a
 *    fixed 6-year cycle and does not model partial renewal or the 1980
 *    abolition (era-gated off entirely outside 1953-default instead — see
 *    `trSenato` in cycleAnchorContext.ts).
 *  - ES Senado: era-gated OFF in 1953-default exactly like
 *    `congresoDiputados` (Franco dictatorship) via a shared null anchor —
 *    not a new simplification, mirrors the existing Congreso gate.
 */
async function ensureBetaSenateElections(
  countryId: CountryId,
  electionType: string,
  now: Date
): Promise<void> {
  const db = await getDb();
  if (!(await countryElectionsLive(db, countryId))) return;
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return;
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [r._id as string, (r as State).stateSenateSeats ?? 1])
  );

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType,
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType,
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return;

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    const spawn = pickNextCanonicalCycle({
      electionType,
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      ctx,
    });
    if (!spawn) continue; // era-gated (ES 1953, TR outside 1953-default) or gate exhausted

    // Open the primary immediately (mirrors ensureBetaParliamentElections):
    // the multi-year cycle far exceeds the 48h window, so the canonical
    // startTurn would otherwise leave a long dead zone.
    const startTurn = currentTurn;
    const startTime = now;
    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType,
      state: regionId,
      seatId: getSeatIdFromElection({ countryId, electionType, state: regionId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(electionType, spawn.cycle, undefined, undefined, ctx),
      status: "active",
      totalSeats: prev?.totalSeats ?? seatsByRegion.get(regionId) ?? 1,
      startTime,
      primaryEndTime,
      endTime,
      startTurn,
      primaryEndTurn: spawn.primaryEndTurn,
      endTurn: spawn.endTurn,
      durationHours: dur.durationHours,
      primaryDurationHours: dur.durationHours - dur.generalDurationHours,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));

  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureBetaSenateElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/** FR Sénat spawner (9-year full-chamber cycle — see simplification note above). */
export async function ensureFRSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("FR", "senat", now);
}

/** IT Senato della Repubblica spawner (concurrent with the Camera — same real election day). */
export async function ensureITSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("IT", "senato", now);
}

/** ES Senado spawner (concurrent with the Congreso; NO-OP in 1953-default — Franco era). */
export async function ensureESSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("ES", "senado", now);
}

/** TR Senate of the Republic spawner (1953-default only — see simplification note above). */
export async function ensureTRSenateElections(now: Date): Promise<void> {
  await ensureBetaSenateElections("TR", "senato", now);
}

/**
 * Standup-cycle spawner for a seceded country's devolved lower chamber
 * (SCO Holyrood / WAL Senedd). Modeled on `ensureIEElections`: one canonical
 * per-sub-region race (AMS constituency tier, seats = the sub-region's
 * `houseDistricts`), scheduled at the NEXT canonical cycle (no
 * `openPrimaryImmediately`) so carried-over MPs hold their seats until the
 * first standup election. A no-op until the country has states (post-secession
 * expansion), so it is safe to run every turn from the country-election phase.
 */
async function ensureSecededChamberElections(
  countryId: CountryId,
  electionType: string,
  now: Date,
  opts?: { seatsByRegion?: Record<string, number>; seatsPerRegion?: number }
): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const regions = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const regionIds = regions.map((r) => r._id as string);
  if (regionIds.length === 0) return; // not stood up yet — no-op
  // Seats per region: an explicit table (regional councils) or a fixed count
  // (governor = 1) overrides the chamber's per-region houseDistricts default.
  const seatsByRegion = new Map<string, number>(
    regions.map((r) => [
      r._id as string,
      opts?.seatsByRegion?.[r._id as string] ??
        opts?.seatsPerRegion ??
        (r as State).houseDistricts ??
        1,
    ])
  );

  // For a per-region chamber (regional councils), keep each region's
  // stateSenateSeats in step with the seat table so legislature pages and
  // elections agree on chamber size — mirrors ensureUKRegionalCouncilElections.
  if (opts?.seatsByRegion) {
    const seatSyncOps: AnyBulkWriteOperation<State>[] = Object.entries(opts.seatsByRegion).map(
      ([regionId, seats]) => ({
        updateOne: {
          filter: { _id: regionId, countryId, stateSenateSeats: { $ne: seats } },
          update: { $set: { stateSenateSeats: seats } },
        },
      })
    );
    if (seatSyncOps.length > 0) {
      await db.collection<State>("states").bulkWrite(seatSyncOps, { ordered: false });
    }
  }

  const liveElections = await db
    .collection<Election>("elections")
    .find({ countryId, electionType, status: { $in: ["active", "upcoming"] } })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({ countryId, electionType, status: { $in: ["completed", "resolved"] } })
    .sort({ updatedAt: -1 })
    .toArray();
  const lastCompleted = (regionId: string): Election | undefined =>
    completedElections.find((e) => e.state === regionId);

  const toInsert: Omit<Election, "_id">[] = [];
  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;
    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;
    const doc = buildCanonicalSpawn({
      electionType,
      countryId,
      state: regionId,
      prev,
      currentTurn,
      now,
      fallbackTotalSeats: seatsByRegion.get(regionId) ?? 1,
      ctx,
      freshStandup: true,
    });
    if (doc) toInsert.push(doc);
  }
  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    electionType,
    state: e.state,
    status: { $in: ["active", "upcoming"] as ElectionStatus[] },
  }));
  const existing = await db
    .collection<Election>("elections")
    .find({ countryId, $or: orFilters }, { projection: { state: 1 } })
    .toArray();
  const existingStates = new Set(existing.map((e) => e.state));
  const toActuallyInsert = toInsert.filter((e) => !existingStates.has(e.state));
  if (toActuallyInsert.length > 0) {
    await db.collection<Election>("elections").insertMany(toActuallyInsert as Election[]);
    console.log(
      `[Turn] ensureSecededChamberElections(${countryId}): spawned ${toActuallyInsert.length} ${electionType} election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/** SCO Holyrood standup spawner (sibling to `ensureIEElections`). */
export async function ensureSCOElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "holyrood", now);
}

/** WAL Senedd standup spawner. */
export async function ensureWALElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "senedd", now);
}

/**
 * Regional-council seats per macro-region = the real number of council areas
 * grouped into each (Scotland's 32 / Wales's 22 principal areas), driving the
 * per-region regionalCouncil chamber size at standup.
 */
const SCO_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  GLA: 6, // Glasgow City, East/West Dunbartonshire, Renfrewshire, East Renfrewshire, Inverclyde
  LOT: 4, // Edinburgh, East/Mid/West Lothian
  HIG: 6, // Highland, Argyll & Bute, Na h-Eileanan Siar, Orkney, Shetland, Moray
  GRA: 2, // Aberdeen City, Aberdeenshire
  TAY: 5, // Dundee, Angus, Perth & Kinross, Fife, Stirling
  STH: 6, // Scottish Borders, Dumfries & Galloway, East/North/South Ayrshire, South Lanarkshire
  CSC: 3, // North Lanarkshire, Falkirk, Clackmannanshire
};
const WAL_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  CDF: 4, // Cardiff, Vale of Glamorgan, Monmouthshire, Newport
  SWA: 5, // Swansea, Carmarthenshire, Pembrokeshire, Bridgend, Neath Port Talbot
  VAL: 5, // Rhondda Cynon Taf, Merthyr Tydfil, Caerphilly, Blaenau Gwent, Torfaen
  MWA: 2, // Powys, Ceredigion
  NWW: 4, // Isle of Anglesey, Gwynedd, Conwy, Denbighshire
  NEW: 2, // Flintshire, Wrexham
};

/** SCO/WAL regional-governor (Provost / Leader) standup — one single-seat race per macro-region. */
export async function ensureSCOGovernorElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "governor", now, { seatsPerRegion: 1 });
}
export async function ensureWALGovernorElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "governor", now, { seatsPerRegion: 1 });
}

/** SCO/WAL regional-council standup — per-region seats from the council-area tables. */
export async function ensureSCORegionalCouncilElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("SCO", "regionalCouncil", now, {
    seatsByRegion: SCO_REGIONAL_COUNCIL_SEATS,
  });
}
export async function ensureWALRegionalCouncilElections(now: Date): Promise<void> {
  await ensureSecededChamberElections("WAL", "regionalCouncil", now, {
    seatsByRegion: WAL_REGIONAL_COUNCIL_SEATS,
  });
}

/**
 * Per-region councillor seat allocation for the IE Local Council.
 * Distributed by population; 200 across the 8 NUTS-III regions, plus NIR's
 * allocation once it reunifies (population-proportional at the same ratio).
 * Mirrors the UK_REGIONAL_COUNCIL_SEATS pattern.
 */
const IE_LOCAL_COUNCIL_SEATS: Record<string, number> = {
  DUB: 62,
  KIL: 26,
  COR: 25,
  DON: 21,
  GAL: 19,
  LIM: 18,
  WEX: 17,
  MID: 12,
  NIR: 95,
};

/**
 * Ensure a nationwide Uachtarán na hÉireann (President of Ireland) election
 * is active or upcoming. Single constituency (state = "IE"), single seat,
 * 7-year cycle. The 1.0 simulation uses the configured direct-plurality
 * resolver; preference-transfer fidelity remains a later electoral upgrade.
 *
 * Mirrors `ensureIEElections` for the spawn pattern but with a fixed
 * 1-element state list (the country code itself, since the Uachtarán race
 * is nationwide rather than per-region). Term limit (2 terms) enforced via
 * `executiveTermLimits.ts` reading the IE config's `executiveTermLimit`.
 */
export async function ensureIEUachtaranElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "uachtaran",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  if (liveElections.length > 0) return;

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "uachtaran",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const prev = completedElections[0];

  if (justResolvedInSameTurn(prev, now, currentTurn)) return;

  const doc = buildCanonicalSpawn({
    electionType: "uachtaran",
    countryId: "IE",
    state: "IE",
    prev,
    currentTurn,
    now,
    fallbackTotalSeats: 1,
    ctx,
    openPrimaryImmediately: true,
  });
  if (!doc) return;

  // Defensive: dedup against any concurrent insert.
  const existing = await db.collection<Election>("elections").findOne({
    countryId: "IE",
    electionType: "uachtaran",
    state: "IE",
    status: { $in: ["active", "upcoming"] },
  });
  if (existing) return;

  await db.collection<Election>("elections").insertOne(doc as Election);
  console.log(`[Turn] ensureIEUachtaranElections: spawned 1 Uachtarán election`);
  sendBatchedElectionAnnouncements([doc], now);
}

/**
 * Ensure every IE region has an active/upcoming Local Council election.
 * Mirrors `ensureIEElections` for the multi-seat per-region pattern,
 * sized from `IE_LOCAL_COUNCIL_SEATS`. 5-year canonical cycle anchored to
 * the preset's `ieLocalCouncil` year (2024 for 2019-default, 1991 for
 * 1991-default).
 */
export async function ensureIELocalCouncilElections(now: Date): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const ieRegions = await db
    .collection<State>("states")
    .find({ countryId: "IE" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = ieRegions.map((r) => r._id as string);
  if (regionIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "localCouncil",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveRegions = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId: "IE",
      electionType: "localCouncil",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(regionId: string): Election | undefined {
    return completedElections.find((e) => e.state === regionId);
  }

  const toInsert: Omit<Election, "_id">[] = [];

  for (const regionId of regionIds) {
    if (liveRegions.has(regionId)) continue;

    const prev = lastCompleted(regionId);
    if (justResolvedInSameTurn(prev, now, currentTurn)) continue;

    // A region joining mid-cycle (NI reunifying) syncs to the live council race.
    const peer = !prev ? liveElections[0] : undefined;
    const doc = peer
      ? mirrorPeerRaceTiming(
          "IE",
          peer,
          regionId,
          "localCouncil",
          IE_LOCAL_COUNCIL_SEATS[regionId] ?? 1,
          now
        )
      : buildCanonicalSpawn({
          electionType: "localCouncil",
          countryId: "IE",
          state: regionId,
          prev,
          currentTurn,
          now,
          fallbackTotalSeats: IE_LOCAL_COUNCIL_SEATS[regionId] ?? 1,
          ctx,
          openPrimaryImmediately: true,
        });
    if (!doc) continue;

    toInsert.push(doc);
  }

  if (toInsert.length === 0) return;

  const orFilters = toInsert.map((e) => ({
    countryId: "IE" as const,
    electionType: "localCouncil" as const,
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
      `[Turn] ensureIELocalCouncilElections: spawned ${toActuallyInsert.length} missing Local Council election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/**
 * Spawn perpetual Cathaoirleach elections for all 8 IE regions on the
 * shared cross-country `governor` cycle (4-year canonical anchor). Single-
 * seat per region. Display label varies per region via
 * `getRegionalExecutive` (Lord Mayor of Dublin/Cork, Mayor of Limerick/
 * Galway, Cathaoirleach elsewhere) — see regionalExecutive.ts.
 */
export async function ensureIECathaoirleachElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("IE", now);
}

/**
 * Ensure every CN macro-region has an active/upcoming Provincial People's
 * Congress election. Mirrors `ensureCNElections` for the sub-national
 * legislature: one multi-seat PR election per province on a 5-year cycle,
 * sized from `CN_PEOPLES_CONGRESS_SEATS`. Canonical cycle is anchored to
 * the NPC end turn so national and provincial elections fire on the same
 * turn (matches real-world quinquennial cadence).
 */
export async function ensureCNPeoplesCongressElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "CN",
      electionType: "peoplesCongress",
      seatsForRegions: (_regions, preset) => getCnPeoplesCongressSeats(preset),
      openPrimaryImmediately: true,
      label: "People's Congress",
    },
    now
  );
}

/**
 * Shared spawner for direct-elected regional executive (the "governor"
 * electionType) in countries that aren't covered by `ensurePerpetualElections`
 * (which is US-only).
 *
 * Used by UK FMs + Mayor of London (SCO/WAL/NIR/LON) and JP regional
 * governors (all 8 regions). Same mechanical shape: single-seat, 4-year
 * cycle (192 turns via `CYCLE_TURNS.governor`), preset-anchored via
 * `electionToLarpYear`. Mirrors `ensureDEElections` for Bundestag.
 *
 * `allowedStateIds`, when provided, restricts spawning to that subset
 * (UK's English non-London regions get no FM/Mayor); when omitted every
 * state in the country is eligible (JP).
 */
async function ensureRegionalGovernorElections(
  countryId: CountryId,
  now: Date,
  allowedStateIds?: ReadonlySet<string>
): Promise<void> {
  const db = await getDb();
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);

  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  const stateIds = states
    .map((s) => s._id as string)
    .filter((id) => !allowedStateIds || allowedStateIds.has(id));
  if (stateIds.length === 0) return;

  const liveElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: "governor",
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();
  const liveGov = new Set(liveElections.map((e) => e.state));

  const completedElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: "governor",
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  function lastCompleted(stateId: string): Election | undefined {
    return completedElections.find((e) => e.state === stateId);
  }

  const dur = DEFAULT_DURATIONS.governor.durationHours;
  const genDur = getGeneralWindow("governor");

  const toInsert: Omit<Election, "_id">[] = [];

  for (const stateId of stateIds) {
    if (liveGov.has(stateId)) continue;

    const prev = lastCompleted(stateId);

    // A region joining mid-cycle (NI reunifying → Cathaoirleach) syncs to a live
    // peer governor race so they resolve together, instead of opening its own.
    if (!prev && liveElections[0]) {
      toInsert.push(mirrorPeerRaceTiming(countryId, liveElections[0], stateId, "governor", 1, now));
      continue;
    }

    const spawn = pickNextCanonicalCycle({
      electionType: "governor",
      countryId,
      prevCycle: prev?.cycle ?? 0,
      currentTurn,
      priorEndTurn: null,
      ctx,
    });
    if (!spawn) continue;

    const primaryEndTime = turnToWallClock(spawn.primaryEndTurn, now, currentTurn);
    const endTime = turnToWallClock(spawn.endTurn, now, currentTurn);

    toInsert.push({
      countryId,
      electionType: "governor",
      state: stateId,
      seatId: getSeatIdFromElection({ countryId, electionType: "governor", state: stateId }),
      cycle: spawn.cycle,
      electionYear: electionToLarpYear(
        "governor",
        spawn.cycle,
        undefined,
        undefined,
        ctx,
        countryId
      ),
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

  // Guard against duplicates (same pattern as ensureDEElections).
  const orFilters = toInsert.map((e) => ({
    countryId,
    electionType: "governor" as const,
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
      `[Turn] ensureRegionalGovernorElections(${countryId}): spawned ${toActuallyInsert.length} missing governor election(s)`
    );
    sendBatchedElectionAnnouncements(toActuallyInsert, now);
  }
}

/** UK regions whose devolved executive is the "governor" electionType.
 *  English non-London regions get no FM/Mayor and are skipped. */
const UK_GOVERNOR_REGIONS: ReadonlySet<string> = new Set(["SCO", "WAL", "NIR", "LON"]);

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

/**
 * Spawn perpetual governor elections for all 8 JP regions on a
 * preset-anchored 4-year cycle.
 */
export async function ensureJPGovernorElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("JP", now);
}

/**
 * Spawn perpetual governor elections for all 7 CN macro-regions on a
 * preset-anchored 5-year cycle.
 *
 * In-universe these aren't competitive races (CCP holds every regional
 * executive in the seeded reality), but the engine still spawns the
 * election so players can stage primary challenges, CDL / CNDCA token
 * candidacies, and so the regional governor seat has a normal succession
 * path (term expiry, retirement, scandal removal) rather than sitting
 * frozen on the seeded NPP forever.
 */
export async function ensureCNGovernorElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("CN", now);
}

/**
 * Spawn a US presidential election if none is currently active or upcoming.
 * Used by the admin "Spawn Presidential Election" tool. Bypasses the turn-year
 * check — invoke when the normal Spawn Missing Elections cron didn't create one.
 *
 * Anchors timing to the canonical LARP schedule via `pickNextCanonicalCycle`
 * so admin-recovery docs are indistinguishable from cron-spawned docs (same
 * `seatId`, `electionYear`, `startTime` / `primaryEndTime` / `endTime`).
 * When the canonical window has already eroded past the 24h+24h gate, falls
 * back to a `now`-anchored doc so the admin button still unblocks recovery.
 *
 * Atomic via findOneAndUpdate + upsert + $setOnInsert: if two admins click the
 * button simultaneously, only one document is inserted. The other call returns
 * the existing doc with created=false.
 */
export async function ensurePresidentialElection(
  now: Date
): Promise<{ message: string; electionId: string; created: boolean }> {
  const db = await getDb();
  const elections = db.collection<Election>("elections");

  // Compute the next cycle from the most recent completed/resolved race.
  // Doesn't need to be atomic — concurrent callers will compute the same
  // cycle; the upsert below ensures only one insertion actually lands.
  const latestPresident = await elections.findOne(
    { electionType: "president", countryId: "US", status: { $in: ["completed", "resolved"] } },
    { sort: { updatedAt: -1 } }
  );

  const dur = DEFAULT_DURATIONS.president.durationHours;
  const pdur = DEFAULT_DURATIONS.president.primaryDurationHours;
  const prevCycle = latestPresident?.cycle ?? 0;

  // Resolve canonical LARP timing for the next cycle. Falls back to a
  // now-anchored doc when the canonical window is unreachable (heavy admin
  // acceleration, far-past gate failure) so the recovery button still works.
  const { currentTurn, ctx } = await getCurrentTurnAndCtx(db);
  const canonical = pickNextCanonicalCycle({
    electionType: "president",
    prevCycle,
    currentTurn,
    ctx,
  });

  let cycle: number;
  let startTime: Date;
  let primaryEndTime: Date;
  let endTime: Date;
  let startTurn: number;
  let primaryEndTurn: number;
  let endTurn: number;
  let status: "active" | "upcoming";
  if (canonical) {
    cycle = canonical.cycle;
    startTime = turnToWallClock(canonical.startTurn, now, currentTurn);
    primaryEndTime = turnToWallClock(canonical.primaryEndTurn, now, currentTurn);
    endTime = turnToWallClock(canonical.endTurn, now, currentTurn);
    startTurn = canonical.startTurn;
    primaryEndTurn = canonical.primaryEndTurn;
    endTurn = canonical.endTurn;
    status = canonical.startTurn <= currentTurn ? "active" : "upcoming";
  } else {
    cycle = prevCycle + 1;
    startTime = now;
    primaryEndTime = new Date(now.getTime() + pdur * 3_600_000);
    endTime = new Date(now.getTime() + dur * 3_600_000);
    startTurn = currentTurn;
    primaryEndTurn = currentTurn + pdur;
    endTurn = currentTurn + dur;
    status = "active";
  }

  const seatId = getSeatIdFromElection({
    countryId: "US",
    electionType: "president",
    state: "US",
  });
  const electionYear = electionToLarpYear("president", cycle, undefined, undefined, ctx);

  // findOneAndUpdate with upsert + $setOnInsert is atomic: if a matching
  // active/upcoming doc exists, it is returned and no insert happens;
  // otherwise a new doc is inserted with the $setOnInsert fields. With
  // returnDocument: "before", we get null on insert and the existing doc on hit.
  const previous = await elections.findOneAndUpdate(
    { electionType: "president", countryId: "US", status: { $in: ["active", "upcoming"] } },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        electionType: "president",
        state: "US",
        countryId: "US",
        seatId,
        cycle,
        electionYear,
        status,
        startTime,
        primaryEndTime,
        endTime,
        startTurn,
        primaryEndTurn,
        endTurn,
        durationHours: dur,
        primaryDurationHours: pdur,
        createdAt: now,
        updatedAt: now,
      } satisfies Election,
    },
    { upsert: true, returnDocument: "before" }
  );

  if (previous) {
    return {
      message: "A presidential election already exists.",
      electionId: previous._id.toString(),
      created: false,
    };
  }

  // No previous doc → the upsert just inserted. Read it back to return its _id.
  const inserted = await elections.findOne({
    electionType: "president",
    countryId: "US",
    status: { $in: ["active", "upcoming"] },
    cycle,
  });
  if (!inserted) {
    throw new Error("Failed to read back inserted presidential election");
  }
  return {
    message: "Presidential election spawned.",
    electionId: inserted._id.toString(),
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Admin Spawn-Elections Registry
// ---------------------------------------------------------------------------
// Used by /api/admin/elections/spawn/[code] to dispatch the right ensure
// function per country. To add a country, export an ensure function above
// and add an entry here. The handler returns a short message plus optional
// metadata; the route normalizes the response envelope.

export interface SpawnElectionsResult {
  message: string;
  electionId?: string;
  created?: boolean;
}

export type SpawnElectionsHandler = (now: Date) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: ensurePresidentialElection,
  UK: async (now) => {
    // Westminster Commons + devolved Regional Councils + Governor seats.
    await ensureUKElections(now);
    await ensureUKRegionalCouncilElections(now);
    await ensureUKGovernorElections(now);
    return { message: "UK Commons / Regional Council / Governor continuity check complete." };
  },
  DE: async (now) => {
    await ensureDEElections(now);
    return { message: "DE Bundestag continuity check complete." };
  },
  JP: async (now) => {
    // Shugiin (lower) + Sangiin (upper, classOverride omitted = natural class) +
    // prefectural Governor seats.
    await ensureJPElections(now);
    await ensureJPCouncillorElections(now);
    await ensureJPGovernorElections(now);
    return { message: "JP Shugiin / Sangiin / Governor continuity check complete." };
  },
  CN: async (now) => {
    // National NPC Delegates + Provincial People's Congress + macro-region Governor.
    await ensureCNElections(now);
    await ensureCNPeoplesCongressElections(now);
    await ensureCNGovernorElections(now);
    return { message: "CN NPC / Provincial Congress / Governor continuity check complete." };
  },
  BR: async (now) => {
    await ensureBRElections(now);
    await ensureBRSenateElections(now);
    return { message: "BR Câmara / Senate continuity check complete." };
  },
  NG: async (now) => {
    await ensureNGElections(now);
    return { message: "NG election continuity check complete." };
  },
  IE: async (now) => {
    await ensureIEElections(now);
    await ensureIEUachtaranElections(now);
    await ensureIELocalCouncilElections(now);
    await ensureIECathaoirleachElections(now);
    return {
      message: "IE Dáil, Uachtarán, Local Council, and Cathaoirleach continuity check complete.",
    };
  },
};
