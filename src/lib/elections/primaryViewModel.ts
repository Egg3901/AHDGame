/**
 * Pure view-model builder for the Phase 4 primary screen.
 *
 * Takes the data the server-side `/president/primary/[partyId]` page
 * already loads (candidates, per-state demographics, projection results,
 * primary timing) and folds it into the shape expected by:
 *  - `TierSelector` (just the active tier — currently always "president")
 *  - `PrimaryCalendar` (waves with past/upcoming flags + state lists)
 *  - `CarveUpPanel` (per-state slices + top-demographics labels)
 *
 * Pure — no DB. Easy to unit-test with hand-rolled fixtures. The server
 * page does the data fetching and threads the inputs through.
 *
 * See plan §"Phase 4 — Tasks" 4.4.
 */

import type { CalendarWave } from "@/components/elections/primary/PrimaryCalendar";
import type { CarveUpSlice } from "@/components/elections/primary/CarveUpPanel";
import { COMPRESSED_SCHEDULE, type PrimaryWaveSchedule } from "@/lib/constants/primaryCalendar";

const MS_PER_HOUR = 3_600_000;

/**
 * Turns remaining until a presidential primary closes, computed turn-first to
 * match the stagger engine (`runPrimaryStaggerWaveIfDue`). The turn counter is
 * the source of truth: it freezes on pause and does not drift when the cron
 * falls behind wall-clock. `primaryEndTime` is a fallback ONLY for primaries
 * not yet backfilled with `primaryEndTurn` — display surfaces must never derive
 * turns from wall-clock when the turn field is present, or the calendar drifts
 * ahead of the engine (UI shows "Super Tuesday now" while the engine, correctly,
 * has not reached the stagger window).
 *
 * Returns null when neither deadline is set (pre-schedule / malformed doc).
 */
export function resolvePrimaryTurnsToEnd(input: {
  primaryEndTurn?: number | null;
  primaryEndTime?: Date | null;
  currentTurn: number;
  now: Date;
}): number | null {
  if (typeof input.primaryEndTurn === "number") {
    return input.primaryEndTurn - input.currentTurn;
  }
  if (input.primaryEndTime) {
    // 1 turn = 1 hour (hourly cron). Ceil so a partial final hour still reads
    // as a remaining turn rather than rounding the wave away early.
    return Math.ceil((input.primaryEndTime.getTime() - input.now.getTime()) / MS_PER_HOUR);
  }
  return null;
}

/**
 * True when `turnsToEnd` falls inside the stagger window. Mirrors
 * `getDuePrimaryWaveCount`'s window bound so the UI's "Stagger" phase label
 * flips on the same turn the engine starts running waves. The window size is
 * schedule-dependent (compressed = 6 turns, stretched = 41), so pass the race's
 * schedule; defaults to compressed to preserve existing callers.
 */
export function isInStaggerWindow(
  turnsToEnd: number | null,
  schedule: PrimaryWaveSchedule = COMPRESSED_SCHEDULE
): boolean {
  return turnsToEnd !== null && turnsToEnd >= 0 && turnsToEnd <= schedule.windowTurns - 1;
}

export interface PrimaryCandidateInfo {
  id: string;
  name: string;
  color: string;
  archetype?: string;
}

export interface PrimaryViewModelInput {
  /** Candidate roster (intra-party). Order is the natural display order. */
  candidates: PrimaryCandidateInfo[];
  /** Projection: stateId → candidateId → votes. From `projectPrimaryByState`. */
  byState: Record<string, Record<string, number>>;
  /**
   * Optional set of state IDs whose primary has actually voted. When set,
   * states in this set render as "past" in the calendar; otherwise the
   * past/upcoming flag falls back to the wave-vs-currentTurn calculation.
   */
  votedStateIds?: ReadonlySet<string>;
  /** Current turn number — drives wave isPast when no votedStateIds passed. */
  currentTurn?: number;
  /** Turn the primary will end on. Used with currentTurn to compute past waves. */
  primaryEndTurn?: number;
  /** Optional per-state top-demographic labels for the CarveUpPanel subtitle. */
  topDemographicsByState?: Record<string, string[]>;
  /** Optional state-name lookup (id → display name) for the CarveUp header. */
  stateNameById?: Record<string, string>;
  /**
   * Wave schedule the race runs (from `getPrimaryWaveSchedule`). Defaults to
   * compressed so the calendar rows match the race's actual spacing.
   */
  schedule?: PrimaryWaveSchedule;
}

export interface PrimaryViewModel {
  candidates: PrimaryCandidateInfo[];
  waves: CalendarWave[];
  /** stateId → ordered slices (largest first). Slices summed across states. */
  perStateSlices: Record<string, CarveUpSlice[]>;
  /** stateId → display name (passthrough from input or fallback to id). */
  stateNameById: Record<string, string>;
  /** Default selected state — first upcoming wave's first state, or first state in calendar. */
  defaultSelectedStateId: string | null;
}

export function buildPrimaryViewModel(input: PrimaryViewModelInput): PrimaryViewModel {
  const candidatesById = new Map(input.candidates.map((c) => [c.id, c]));

  const waves = buildCalendarWaves({
    votedStateIds: input.votedStateIds,
    currentTurn: input.currentTurn,
    primaryEndTurn: input.primaryEndTurn,
    schedule: input.schedule,
  });

  const perStateSlices: Record<string, CarveUpSlice[]> = {};
  for (const [stateId, votesByCandidate] of Object.entries(input.byState)) {
    const total = Object.values(votesByCandidate).reduce((s, v) => s + Math.max(0, v), 0);
    if (total <= 0) {
      perStateSlices[stateId] = [];
      continue;
    }
    const slices: CarveUpSlice[] = [];
    for (const [candidateId, votes] of Object.entries(votesByCandidate)) {
      if (votes <= 0) continue;
      const candidate = candidatesById.get(candidateId);
      if (!candidate) continue;
      slices.push({
        candidateId,
        candidateName: candidate.name,
        color: candidate.color,
        archetype: candidate.archetype,
        pct: (votes / total) * 100,
      });
    }
    slices.sort((a, b) => b.pct - a.pct);
    perStateSlices[stateId] = slices;
  }

  const stateNameById: Record<string, string> = {};
  for (const wave of waves) {
    for (const stateId of wave.stateIds) {
      stateNameById[stateId] = input.stateNameById?.[stateId] ?? stateId;
    }
  }

  const defaultSelectedStateId = pickDefaultSelectedState(waves);

  return {
    candidates: input.candidates,
    waves,
    perStateSlices,
    stateNameById,
    defaultSelectedStateId,
  };
}

/**
 * Build the calendar wave rows from `PRIMARY_WAVES`. A wave is "past" when
 * either:
 *   - its turnsRemaining > (primaryEndTurn - currentTurn), OR
 *   - any of its states is in `votedStateIds` (preferred when available;
 *     handles ad-hoc admin force-resolves)
 *
 * Returns waves in calendar order (earliest first — which is highest
 * turnsRemaining first per the wave-table convention).
 */
export function buildCalendarWaves(input: {
  votedStateIds?: ReadonlySet<string>;
  currentTurn?: number;
  primaryEndTurn?: number;
  schedule?: PrimaryWaveSchedule;
}): CalendarWave[] {
  const turnsToEnd =
    input.primaryEndTurn !== undefined && input.currentTurn !== undefined
      ? Math.max(0, input.primaryEndTurn - input.currentTurn)
      : null;

  const schedule = input.schedule ?? COMPRESSED_SCHEDULE;
  return schedule.waves
    .map((w) => {
      let isPast: boolean;
      if (input.votedStateIds && input.votedStateIds.size > 0) {
        // Wave is past if any of its states already voted.
        isPast = w.states.some((s) => input.votedStateIds!.has(s));
      } else if (turnsToEnd !== null) {
        // Wave fires at T-turnsRemaining. If turnsToEnd < turnsRemaining, the
        // wave's turn has already passed.
        isPast = turnsToEnd < w.turnsRemaining;
      } else {
        isPast = false;
      }
      return {
        label: w.label,
        turnsRemaining: w.turnsRemaining,
        isPast,
        stateIds: [...w.states],
      };
    })
    .sort((a, b) => b.turnsRemaining - a.turnsRemaining);
}

/**
 * Default selected state for the carve-up panel: the first state of the
 * earliest upcoming wave, or — if every wave is past — the first state of
 * the first wave (lets the user inspect closed contests).
 *
 * Returns null if there are no waves at all.
 */
export function pickDefaultSelectedState(waves: CalendarWave[]): string | null {
  if (waves.length === 0) return null;
  const upcoming = waves.find((w) => !w.isPast && w.stateIds.length > 0);
  if (upcoming) return upcoming.stateIds[0];
  // Otherwise pick the first state of the first wave (or null if empty).
  for (const w of waves) {
    if (w.stateIds.length > 0) return w.stateIds[0];
  }
  return null;
}
