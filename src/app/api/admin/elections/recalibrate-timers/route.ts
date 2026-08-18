/**
 * POST /api/admin/elections/recalibrate-timers
 *
 * Recalculates primaryEndTime and endTime for every active/upcoming election
 * so they match the canonical LARP schedule, correcting drift caused by
 * batch/manual turn firing.
 *
 * Root cause: election timestamps are wall-clock absolute dates (now + Nh),
 * but batch turns advance currentTurn instantly without advancing the clock.
 * After firing 150 turns in seconds, a House cycle-1 election created at
 * game start still has endTime = "game_start + 96h" (far in the future on
 * the clock) even though LARP turn 96 passed long ago.
 *
 * Canonical schedule (1 turn = 1 real hour, 48 turns = 1 LARP year):
 *   House  cycle 1       → endTurn = 144  (bootstrap ends 2022; 48h general)
 *   House  cycle N≥2     → endTurn = 144 + (N−1) × 96  (2024, 2026, …; 48h general)
 *   Senate class C cycle 1 → endTurn = SENATE_CYCLE1_END_TURN[C] (C2=336, C3=144, C1=240)
 *   Senate class C cycle N≥2 → endTurn = SENATE_CYCLE1_END_TURN[C] + (N−1) × 288
 *   Governor  cycle 1    → endTurn = 240  (bootstrap ends 2024)
 *   Governor  cycle N≥2  → endTurn = 240 + (N−1) × 192
 *   StateSenate cycle 1  → endTurn = 240  (bootstrap ends 2024)
 *   StateSenate cycle N≥2 → endTurn = 240 + (N−1) × 192
 *   President cycle 1    → endTurn = 240  (bootstrap ends 2024; 24h general)
 *   President cycle N≥2  → endTurn = 240 + (N−1) × 192
 *   UK Commons cycle 1   → endTurn = 219  (bootstrap: July 2024 general election)
 *   UK Commons cycle N≥2 → if a snap_commons (or regular commons) has resolved for
 *                          the region, endTurn = priorEndTurn + 240; otherwise
 *                          219 + (N−1) × 240.
 *   UK RegionalCouncil   → five annual cohorts; each region retains a 5-year term
 *   JP Shugiin cycle 1   → endTurn = 240  (bootstrap ends 2024)
 *   JP Shugiin cycle N≥2 → if a snap_shugiin (or regular shugiin) has resolved for
 *                          the region, endTurn = priorEndTurn + 192; otherwise
 *                          240 + (N−1) × 192.
 *   JP Sangiin class C cycle 1 → endTurn = JP_SANGIIN_CYCLE1_END_TURN[C] (C1=123 Jul 2022, C2=267 Jul 2025)
 *   JP Sangiin class C cycle N≥2 → endTurn = JP_SANGIIN_CYCLE1_END_TURN[C] + (N−1) × 288  (6-year term per class; stagger between classes is 144)
 *   JP Governor           → same formula as US Governor
 *
 *   primaryEndTurn = endTurn − generalDurationHours
 *   startTime is always in the past (zero-gap: primaries open immediately)
 *
 * Elections whose canonical endTurn ≤ currentTurn are already past due:
 * their endTime is set to now−1s so the next turn completes them and the
 * perpetual-election system can spawn the next cycle.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { invalidateGameTimeCache } from "@/lib/time/gameTime";
import {
  ensurePerpetualElections,
  ensureUKElections,
  ensureUKRegionalCouncilElections,
} from "@/lib/turnSystem";
import {
  ensureDEElections,
  ensureJPElections,
  ensureJPCouncillorElections,
} from "@/lib/turn/perpetualElections";
import type { Filter } from "mongodb";
import type { Election, GameState } from "@/lib/db/types";
import {
  MS_PER_TURN,
  SENATE_STAGGER_TURNS,
  UK_COMMONS_CYCLE_PERIOD_HOURS,
  JP_SANGIIN_CYCLE_PERIOD_HOURS,
} from "@/lib/constants/turnTime";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";
import {
  DEFAULT_CYCLE_ANCHOR_CONTEXT,
  cycleAnchorContextFromGameState,
  getCycleAnchors,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";

const DE_BUNDESTAG_CYCLE_PERIOD_HOURS = 192; // 4 game-years — period only, not preset-dependent
const IE_DAIL_CYCLE_PERIOD_HOURS = 192; // 4 game-years
const IE_UACHTARAN_CYCLE_PERIOD_HOURS = 336; // 7 game-years
const IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS = 240; // 5 game-years
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { electionToLarpYear } from "@/lib/utils/formatters";
import { getLandtagAnchor } from "@/lib/seeds/de/deLandtag";
import { getUKRegionalCouncilCycle1EndTurn } from "@/lib/elections/ukRegionalCouncilStagger";

/**
 * Derive the canonical LARP end-turn, primary-end-turn, and start-turn for
 * an election. Thin adapter around the shared `canonicalTurnsForCycle`
 * formula so the recalibrate route and the cron-driven spawners use the
 * exact same math — no more duplicate cycle-anchor tables.
 *
 * Pass `ctx` from the active GameState (via `cycleAnchorContextFromGameState`)
 * so 1991 games produce 1991-era cycle endTurns. Defaults to the
 * 2019-default preset for back-compat with callers that haven't been
 * threaded yet (tests + any legacy code path).
 */
export function canonicalTurns(
  election: Election,
  priorEndTurn?: number | null,
  ctx: CycleAnchorContext = DEFAULT_CYCLE_ANCHOR_CONTEXT
): { endTurn: number; primaryEndTurn: number; startTurn: number } | null {
  const { electionType, senateClass, cycle, state } = election;
  if (cycle == null || !electionType) return null;
  const chamberClass = (election as { chamberClass?: number }).chamberClass;
  const customCycle1EndTurn =
    electionType === "landtag" && state
      ? getLandtagAnchor(state, ctx.preset)
      : electionType === "regionalCouncil" && election.countryId === "UK" && state
        ? getUKRegionalCouncilCycle1EndTurn(state, ctx)
        : undefined;
  return canonicalTurnsForCycle({
    electionType,
    cycle,
    // Country-aware branches (NG concurrent-general; RU governor → republic-
    // soviet anchor, D10) need the owning country — without it the recalibrate
    // math silently falls back to the US-style schedule for those races.
    countryId: election.countryId,
    senateClass: (senateClass ?? null) as 1 | 2 | 3 | null,
    chamberClass: (chamberClass ?? null) as 1 | 2 | null,
    priorEndTurn: priorEndTurn ?? null,
    customCycle1EndTurn,
    ctx,
  });
}

/**
 * Build the seat key used to look up sitting officials for an election.
 *
 * Senate uses `senateClass`; JP Sangiin uses `chamberClass` (separate fields
 * on Election so single-seat US Senate logic doesn't conflate with the
 * proportional JP upper chamber — see the `chamberClass` doc on Election in
 * src/lib/db/types/character.ts). Both must be in the key so two staggered
 * classes in the same state don't collide.
 */
/**
 * Effective `startTurn` for a recalibrated active election. Recalibration
 * forces `status: "active"` and a past `startTime` for every live race, so a
 * not-yet-started canonical `startTurn` (short-window types whose cycle period
 * exceeds their `durationHours` — UK commons, IE/CN/BR/JP-sangiin) must be
 * clamped to `currentTurn`; otherwise the turn-first phase helpers read the
 * future `startTurn` and report the race as "upcoming"/"Opens in X turns"
 * despite the active status. Past-or-equal starts (US-style zero-gap cycles)
 * pass through unchanged.
 */
export function effectiveStartTurn(canonicalStartTurn: number, currentTurn: number): number {
  return Math.min(canonicalStartTurn, currentTurn);
}

function seatKeyFor(election: Election): string {
  const ec = election as Election & { chamberClass?: number };
  return `${election.electionType}|${election.state ?? ""}|${election.senateClass ?? ""}|${ec.chamberClass ?? ""}`;
}

/**
 * Decide whether Step 0 should reactivate a `completed`/`resolved` election
 * back to `active` because its canonical endTurn is still in the future.
 *
 * Reactivates only when the election is *premature without* having actually
 * been resolved. Signals that resolution already ran:
 *   - the seat has a non-vacant `electedOfficials` row (`seatedSet`)
 *   - the vote tally is finalized (`finalizedSet`)
 *
 * If either is true, leave the election alone and let the perpetual-election
 * spawn helpers create a fresh next cycle. Reactivating in that case wipes
 * the apparent withdrawal of every player whose candidacy was withdrawn during
 * the prior resolution — see healRecalibrateWithdrawals.ts for the heal that
 * recovered victims of the prior unguarded behavior.
 */
export function shouldReactivatePrematureElection(
  election: Election,
  currentTurn: number,
  finalizedSet: Set<string>,
  seatedSet: Set<string>,
  ctx: CycleAnchorContext = DEFAULT_CYCLE_ANCHOR_CONTEXT
): boolean {
  if (election.cycle == null || !election.electionType) return false;
  const canonical = canonicalTurns(election, undefined, ctx);
  if (!canonical) return false;
  if (canonical.endTurn <= currentTurn) return false;
  if (finalizedSet.has(election._id.toString())) return false;
  if (seatedSet.has(seatKeyFor(election))) return false;
  return true;
}

// POST /api/admin/elections/recalibrate-timers — Recalculates election timer dates to match the canonical LARP schedule, correcting drift from batch turn firing.
// Auth: requireAdmin
// Errors: 403, 404
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState();
    if (!gameState) {
      return NextResponse.json({ error: "Game state not found" }, { status: 404 });
    }

    const currentTurn = gameState.currentTurn;
    // Preset-aware cycle context — drives canonicalTurns() so 1991 games
    // recalibrate to 1991-era cycle anchors, 2019 games to 2024 GE etc.
    const ctx = cycleAnchorContextFromGameState(gameState);
    const anchors = getCycleAnchors(ctx);
    const now = new Date();
    // Use lastTurnProcessed as the time reference, floored to the hour so
    // recalibrated timestamps land on clean turn boundaries.
    const rawRef = gameState.lastTurnProcessed ? new Date(gameState.lastTurnProcessed) : now;
    const ref = new Date(
      rawRef.getFullYear(),
      rawRef.getMonth(),
      rawRef.getDate(),
      rawRef.getHours(),
      0,
      0,
      0
    );

    // Persist the floored ref as lastTurnProcessed so all future turn processing
    // and election timestamps stay aligned to hour boundaries.
    if (ref.getTime() !== rawRef.getTime()) {
      await db
        .collection<GameState>("gameState")
        .updateOne({ _id: "current" } as Filter<GameState>, {
          $set: { lastTurnProcessed: ref, updatedAt: now },
        });
      invalidateGameTimeCache();
    }

    let reactivated = 0;
    let pruned = 0;
    let renumbered = 0;

    // ── Step 0: Reactivate prematurely completed elections ─────────────────
    // If a completed election's canonical endTurn is still in the future,
    // it was closed too early. Only check recent completions (last 500) to
    // avoid scanning thousands of old elections on live servers.
    //
    // A finalized vote tally (or any non-vacant electedOfficial seated at the
    // election's resolution time) means resolution actually ran — winner
    // seated, candidates marked withdrawn, careerHistory written. Reactivating
    // such an election just leaves it in a corrupted "active but already
    // decided" state where the seat is held but the candidates are missing,
    // so we skip those and let `ensurePerpetualElections` spawn a fresh next
    // cycle instead. See healRecalibrateWithdrawals.ts for the data heal that
    // recovers victims of the prior unguarded behavior.
    //
    // Wrapped in try-catch so failures here don't block the core recalibration.
    try {
      const recentCompleted = await db
        .collection<Election>("elections")
        .find({ status: { $in: ["completed", "resolved"] } })
        .sort({ updatedAt: -1 })
        .limit(500)
        .toArray();

      // Pre-fetch finalized tallies + sitting officials so we can detect
      // already-resolved elections without a per-election round trip.
      const candidateIds = recentCompleted.map((e) => e._id);
      const [finalizedTallies, sittingOfficials] = await Promise.all([
        db
          .collection<{ electionId: Election["_id"]; finalized?: boolean }>("electionVoteTallies")
          .find({ electionId: { $in: candidateIds }, finalized: true })
          .project({ electionId: 1 })
          .toArray(),
        db
          .collection<{
            officeType: string;
            state?: string;
            senateClass?: number;
            chamberClass?: number;
            characterId?: import("mongodb").ObjectId | null;
          }>("electedOfficials")
          .find({ characterId: { $ne: null } })
          .project({ officeType: 1, state: 1, senateClass: 1, chamberClass: 1, characterId: 1 })
          .toArray(),
      ]);
      const finalizedSet = new Set(finalizedTallies.map((t) => t.electionId.toString()));
      const seatedSet = new Set(
        sittingOfficials.map(
          (o) => `${o.officeType}|${o.state ?? ""}|${o.senateClass ?? ""}|${o.chamberClass ?? ""}`
        )
      );

      const reactivateOps: {
        updateOne: {
          filter: { _id: Election["_id"] };
          update: { $set: Record<string, unknown> };
        };
      }[] = [];

      let skippedAlreadyResolved = 0;
      for (const election of recentCompleted) {
        // Skip if the election doc itself is malformed (no cycle/type) OR has
        // no canonical schedule OR its canonical end is already past — these
        // are filtered inside shouldReactivatePrematureElection too, but we
        // still need to count "already-resolved" skips separately for logging.
        if (
          !shouldReactivatePrematureElection(election, currentTurn, finalizedSet, seatedSet, ctx)
        ) {
          if (
            election.cycle != null &&
            election.electionType &&
            (finalizedSet.has(election._id.toString()) || seatedSet.has(seatKeyFor(election)))
          ) {
            skippedAlreadyResolved++;
          }
          continue;
        }

        reactivateOps.push({
          updateOne: {
            filter: { _id: election._id },
            update: { $set: { status: "active", updatedAt: now } },
          },
        });
        reactivated++;
      }

      if (reactivateOps.length > 0) {
        await db.collection<Election>("elections").bulkWrite(reactivateOps);
      }
      if (skippedAlreadyResolved > 0) {
        console.log(
          `[Recalibrate] Step 0: skipped ${skippedAlreadyResolved} already-resolved election(s); reactivated ${reactivated}`
        );
      }
    } catch (err) {
      console.error("[Recalibrate] Step 0 (reactivation) failed:", err);
    }

    // ── Step 0b: Fix elections with premature cycle numbers ──────────────
    // If an election's cycle is too high for the current turn, renumber it.
    // Wrapped in try-catch so failures here don't block the core recalibration.
    try {
      const allActive = await db
        .collection<Election>("elections")
        .find({ status: { $in: ["active", "upcoming"] } })
        .toArray();

      function expectedCycleForTurn(election: Election): number | null {
        if (election.cycle == null || !election.electionType) return null;
        // For lower-chamber types where a snap has resolved, the cycle math
        // is anchored to the snap's endTurn, not the bootstrap — don't use
        // step 0b renumbering for those (canonicalTurns handles it).
        if (["commons", "regionalCouncil", "shugiin"].includes(election.electionType)) {
          return election.cycle;
        }
        for (let n = 1; n <= (election.cycle ?? 1) + 1; n++) {
          const test = { ...election, cycle: n } as Election;
          const canonical = canonicalTurns(test, undefined, ctx);
          if (canonical && canonical.endTurn > currentTurn) return n;
        }
        return election.cycle;
      }

      const renumberOps: {
        updateOne: {
          filter: { _id: Election["_id"] };
          update: { $set: Record<string, unknown> };
        };
      }[] = [];

      const raceKey = (e: Election) => {
        const base = `${e.electionType}_${e.state}`;
        // Senate and Sangiin have class-based staggering — include class in key
        // to prevent different classes from being treated as duplicate races
        if (e.electionType === "senate") return `${base}_${e.senateClass}`;
        if (e.electionType === "sangiin")
          return `${base}_${(e as { chamberClass?: number }).chamberClass}`;
        return base;
      };
      const raceElections = new Map<string, Election[]>();
      for (const e of allActive) {
        if (e.cycle == null || !e.electionType) continue;
        const key = raceKey(e);
        if (!raceElections.has(key)) raceElections.set(key, []);
        raceElections.get(key)!.push(e);
      }

      const toDeletePremature: Election["_id"][] = [];

      for (const [, raceGroup] of raceElections) {
        raceGroup.sort((a, b) => a.cycle - b.cycle);

        for (const e of raceGroup) {
          const expected = expectedCycleForTurn(e);
          if (expected !== null && e.cycle > expected) {
            const existingAtExpected = raceGroup.find(
              (other) => other._id !== e._id && other.cycle === expected
            );
            if (existingAtExpected) {
              toDeletePremature.push(e._id);
              pruned++;
            } else {
              const electionYear = electionToLarpYear(
                e.electionType,
                expected,
                e.senateClass,
                e.chamberClass,
                ctx
              );
              renumberOps.push({
                updateOne: {
                  filter: { _id: e._id },
                  update: { $set: { cycle: expected, electionYear, updatedAt: now } },
                },
              });
              e.cycle = expected;
              e.electionYear = electionYear;
              renumbered++;
            }
          }
        }
      }

      if (renumberOps.length > 0) {
        await db.collection<Election>("elections").bulkWrite(renumberOps);
      }
      if (toDeletePremature.length > 0) {
        await db
          .collection("electionCandidates")
          .deleteMany({ electionId: { $in: toDeletePremature } });
        await db
          .collection("electionVoteTallies")
          .deleteMany({ electionId: { $in: toDeletePremature } });
        await db.collection<Election>("elections").deleteMany({ _id: { $in: toDeletePremature } });
      }
    } catch (err) {
      console.error("[Recalibrate] Step 0b (cycle renumbering) failed:", err);
    }

    // ── Step 1: Recalibrate all active/upcoming elections ────────────────
    const elections = await db
      .collection<Election>("elections")
      .find({ status: { $in: ["active", "upcoming"] } })
      .toArray();

    if (elections.length === 0 && reactivated === 0) {
      return NextResponse.json({ message: "No elections to recalibrate." });
    }

    // Build a map of priorEndTurn for each region that has a resolved
    // lower-chamber or snap election. Used to shift the LARP cycle anchor
    // for commons/shugiin post-snap. Regional councils have fixed cohorts.
    //
    // Key: `${countryId}:${electionType}:${state}` where electionType is the
    // REGULAR type (e.g. "commons"). Value: the most-recent prior end turn
    // (measured in turns from the start of the game).
    const priorEndTurnByRace = new Map<string, number>();
    const lowerChamberTypeMap: Record<string, string[]> = {
      commons: ["commons", "snap_commons"],
      shugiin: ["shugiin", "snap_shugiin"],
    };
    for (const [regularType, candidateTypes] of Object.entries(lowerChamberTypeMap)) {
      const prior = await db
        .collection<Election>("elections")
        .find({
          electionType: { $in: candidateTypes },
          status: { $in: ["completed", "resolved"] },
        })
        .sort({ endTime: -1 })
        .toArray();
      const seen = new Set<string>();
      for (const e of prior) {
        if (!e.endTime || !e.state || !e.countryId) continue;
        const key = `${e.countryId}:${regularType}:${e.state}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Convert endTime to a turn number using ref as anchor:
        //   turn = currentTurn - (ref.ms - endTime.ms) / MS_PER_TURN
        const priorMs = new Date(e.endTime).getTime();
        const turnsAgo = Math.round((ref.getTime() - priorMs) / MS_PER_TURN);
        priorEndTurnByRace.set(key, currentTurn - turnsAgo);
      }
    }

    function priorEndTurnFor(election: Election): number | null {
      const type = election.electionType;
      if (!["commons", "shugiin", "bundestag"].includes(type)) return null;
      if (!election.state || !election.countryId) return null;
      return priorEndTurnByRace.get(`${election.countryId}:${type}:${election.state}`) ?? null;
    }

    // Determine the "current" cycle for each election type.
    // Only the current cycle (endTurn > currentTurn) and ONE past-due cycle should exist.
    // Elections from future cycles (spawned by rapid turn firing) get deleted.
    function expectedMaxCycle(electionType: string, senateClass?: number | null): number {
      const dur = DEFAULT_DURATIONS[electionType];
      if (!dur) return 999;
      // Pattern: find the current cycle (smallest N where endTurn > currentTurn),
      // then allow current + 1 buffer. The +1 MUST be outside Math.max so it's
      // always applied — otherwise staggered classes at low turns get pruned.
      if (electionType === "senate") {
        // Senate uses per-class cycle-1 anchors; stagger-based estimate is approximate but safe.
        const stagger = SENATE_STAGGER_TURNS[senateClass ?? 1] ?? 0;
        return Math.max(1, Math.ceil((currentTurn - stagger) / dur.durationHours)) + 1;
      }
      if (electionType === "house") {
        if (currentTurn <= anchors.house) return 2;
        return Math.max(2, Math.ceil((currentTurn - anchors.house) / dur.durationHours) + 2) + 1;
      }
      if (electionType === "commons" || electionType === "regionalCouncil") {
        if (currentTurn <= anchors.ukCommons) return 2;
        return (
          Math.max(
            1,
            Math.ceil((currentTurn - anchors.ukCommons) / UK_COMMONS_CYCLE_PERIOD_HOURS) + 1
          ) + 1
        );
      }
      if (electionType === "president") {
        return Math.max(1, Math.ceil(currentTurn / 192)) + 1;
      }
      if (electionType === "shugiin") {
        if (currentTurn <= anchors.jpShugiin) return 2;
        return (
          Math.max(2, Math.ceil((currentTurn - anchors.jpShugiin) / dur.durationHours) + 2) + 1
        );
      }
      if (electionType === "bundestag") {
        if (currentTurn <= anchors.deBundestag) return 2;
        return (
          Math.max(
            2,
            Math.ceil((currentTurn - anchors.deBundestag) / DE_BUNDESTAG_CYCLE_PERIOD_HOURS) + 2
          ) + 1
        );
      }
      if (electionType === "sangiin") {
        const cycle1End = senateClass === 2 ? anchors.jpSangiinClass2 : anchors.jpSangiinClass1;
        if (currentTurn <= cycle1End) return 2;
        // Each class's term is 288 turns, not durationHours (144) — see canonicalTurns.
        return (
          Math.max(2, Math.ceil((currentTurn - cycle1End) / JP_SANGIIN_CYCLE_PERIOD_HOURS) + 2) + 1
        );
      }
      if (electionType === "npcDelegate" || electionType === "peoplesCongress") {
        // CN NPC + Provincial People's Congress: 5-year cycle (240 turns),
        // preset-anchored. The cycle period is 240 — NOT `dur.durationHours`
        // (48, the election window) — so a default fallback would
        // over-estimate cycles by 5x.
        if (currentTurn <= anchors.cnNpcDelegate) return 2;
        return Math.max(2, Math.ceil((currentTurn - anchors.cnNpcDelegate) / 240) + 2) + 1;
      }
      if (electionType === "dail") {
        if (currentTurn <= anchors.ieDail) return 2;
        return (
          Math.max(2, Math.ceil((currentTurn - anchors.ieDail) / IE_DAIL_CYCLE_PERIOD_HOURS) + 2) +
          1
        );
      }
      if (electionType === "uachtaran") {
        if (currentTurn <= anchors.ieUachtaran) return 2;
        return (
          Math.max(
            2,
            Math.ceil((currentTurn - anchors.ieUachtaran) / IE_UACHTARAN_CYCLE_PERIOD_HOURS) + 2
          ) + 1
        );
      }
      if (electionType === "localCouncil") {
        if (currentTurn <= anchors.ieLocalCouncil) return 2;
        return (
          Math.max(
            2,
            Math.ceil(
              (currentTurn - anchors.ieLocalCouncil) / IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS
            ) + 2
          ) + 1
        );
      }
      return Math.max(1, Math.ceil(currentTurn / dur.durationHours)) + 1;
    }

    const ops: {
      updateOne: {
        filter: { _id: Election["_id"] };
        update: { $set: Record<string, unknown> };
      };
    }[] = [];
    const toDelete: Election["_id"][] = [];

    let recalibrated = 0;
    let pastDue = 0;
    let skipped = 0;

    for (const election of elections) {
      const canonical = canonicalTurns(election, priorEndTurnFor(election), ctx);
      if (!canonical) {
        skipped++;
        continue;
      }

      // Prune elections from cycles that are too far in the future.
      // Skip the prune check for races where a prior snap has resolved —
      // snaps advance the cycle counter, so formula-based expectedMaxCycle
      // can under-count valid cycles. The history-aware canonicalTurns above
      // already computes correct timestamps for post-snap cycles.
      const hasPriorSnapShift = priorEndTurnFor(election) != null;
      if (!hasPriorSnapShift) {
        const classForCycle =
          election.electionType === "sangiin"
            ? ((election as { chamberClass?: number }).chamberClass ?? election.senateClass)
            : election.senateClass;
        const maxCycle = expectedMaxCycle(election.electionType, classForCycle);
        if (election.cycle > maxCycle) {
          toDelete.push(election._id);
          pruned++;
          continue;
        }
      }

      const { endTurn, primaryEndTurn, startTurn } = canonical;
      const turnsUntilEnd = endTurn - currentTurn;
      const turnsUntilPrimary = primaryEndTurn - currentTurn;
      const turnsUntilStart = startTurn - currentTurn;

      // Use ref (game time) for all past timestamps — NOT real wall clock.
      // The display uses lastTurnProcessed as reference, so timestamps must be
      // relative to ref to show correct countdowns ("Ended" not "14m").
      const pastRef = new Date(ref.getTime() - 1000); // 1s before game time = definitively in the past

      if (turnsUntilEnd <= 0) {
        // Election is past its canonical close — mark it as finishing so the
        // next turn sweep can complete it and spawn the next cycle.
        ops.push({
          updateOne: {
            filter: { _id: election._id },
            update: {
              $set: {
                endTime: pastRef,
                primaryEndTime: pastRef,
                startTime: pastRef,
                // Canonical turn bounds are authoritative for the turn-first
                // resolver; endTurn <= currentTurn here so the next sweep closes it.
                endTurn,
                primaryEndTurn,
                startTurn,
                status: "active",
                updatedAt: now,
              },
            },
          },
        });
        pastDue++;
      } else {
        // Anchor to lastTurnProcessed so LARP date display (which also uses
        // lastTurnProcessed as reference) shows the correct week/year.
        const newEndTime = new Date(ref.getTime() + turnsUntilEnd * MS_PER_TURN);
        // Primary may already be closed (we're in the general phase).
        const newPrimaryEndTime =
          turnsUntilPrimary <= 0
            ? pastRef // already in general
            : new Date(ref.getTime() + turnsUntilPrimary * MS_PER_TURN);
        // Zero-gap: startTime is always in the past (startTurn <= currentTurn for active cycles).
        const newStartTime =
          turnsUntilStart <= 0
            ? new Date(ref.getTime() + turnsUntilStart * MS_PER_TURN) // anchored to ref
            : pastRef; // not yet started — treat as just started

        ops.push({
          updateOne: {
            filter: { _id: election._id },
            update: {
              $set: {
                endTime: newEndTime,
                primaryEndTime: newPrimaryEndTime,
                startTime: newStartTime,
                // Canonical turn bounds — the turn-first resolver reads these;
                // the Dates above are display/fallback derived from the same turns.
                // Clamp a not-yet-started canonical start to currentTurn so the
                // forced active status is consistent with the turn-first phase
                // helpers (no spurious "Opens in X turns" for short-window types).
                endTurn,
                primaryEndTurn,
                startTurn: effectiveStartTurn(startTurn, currentTurn),
                status: "active",
                updatedAt: now,
              },
            },
          },
        });
        recalibrated++;
      }
    }

    if (ops.length > 0) {
      await db.collection<Election>("elections").bulkWrite(ops);
    }

    // Delete pruned elections and their candidates
    if (toDelete.length > 0) {
      await db.collection("electionCandidates").deleteMany({ electionId: { $in: toDelete } });
      await db.collection("electionVoteTallies").deleteMany({ electionId: { $in: toDelete } });
      await db.collection<Election>("elections").deleteMany({ _id: { $in: toDelete } });
    }

    // Only re-spawn missing elections if some were actually pruned or deleted.
    // Re-spawning unconditionally can create elections with stale ref-based
    // timestamps that land near wall-clock time after batch turns.
    if (pruned > 0 || toDelete.length > 0) {
      await ensurePerpetualElections(ref);
      await ensureUKElections(ref);
      await ensureUKRegionalCouncilElections(ref);
      await ensureDEElections(ref);
      await ensureJPElections(ref);
      await ensureJPCouncillorElections(ref);
    }

    const parts: string[] = [];
    if (reactivated > 0)
      parts.push(
        `${reactivated} prematurely completed elections reactivated (canonical endTurn still in future)`
      );
    if (recalibrated > 0) parts.push(`${recalibrated} recalibrated to correct LARP schedule`);
    if (pastDue > 0)
      parts.push(`${pastDue} past-due (endTime set to now−1s — run a turn to close them)`);
    if (pruned > 0)
      parts.push(
        `${pruned} future-cycle elections deleted (spawned too early by rapid turn firing)`
      );
    if (renumbered > 0)
      parts.push(`${renumbered} elections renumbered to correct cycle for current turn`);
    if (skipped > 0) parts.push(`${skipped} skipped (unknown type)`);

    return NextResponse.json({
      message: parts.length ? parts.join("; ") + "." : "Nothing to update.",
      currentTurn,
      counts: { reactivated, renumbered, recalibrated, pastDue, skipped, pruned },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
