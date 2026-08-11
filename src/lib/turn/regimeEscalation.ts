/**
 * Pure stage-threshold + dwell-counter math for the regime escalation
 * state machine. No DB access, no side effects — the per-turn driver
 * (`regimeEscalationTurn.ts`) sequences the reads + writes.
 *
 * The state machine is forward-only: once a country enters a stage,
 * it stays there until an explicit decision-event action (Phase 4)
 * moves it back. The pure compute here never regresses a stage on
 * raw scalar recovery — that would let a country oscillate
 * Stage 1 ↔ Stable every turn as popular legitimacy drifts across 60.
 *
 * See `docs/superpowers/specs/2026-05-28-one-party-state-collapse-design.md`
 * § "Stage-transition guards" for the threshold + dwell table.
 */
import type { DwellCounters, RegimeStage } from "@/lib/db/types/regimeEscalation";

export const STAGE_THRESHOLDS = {
  stage1: {
    /** Popular at or below this triggers stage1 dwell accumulation. */
    entryPopular: 60,
    /** Dwell turns required before the stage1 transition fires. */
    dwellTurns: 12,
  },
  stage2: {
    /** Popular at or below this triggers stage2 dwell accumulation. */
    entryPopular: 35,
    /** Consecutive turns below threshold for the "sustained" trigger. */
    dwellSustained: 36,
    /** Cumulative turns below threshold within the sliding window. */
    dwellCumulative: 48,
    /** Sliding window length (turns) for the cumulative counter. */
    windowTurns: 168,
  },
  stage3: {
    /** PartyConfidence STRICTLY below this triggers stage3 dwell. */
    entryPartyConfidence: 15,
    /** Dwell turns required before the stage3 transition fires. */
    dwellTurns: 24,
  },
  stage4: {
    /** Popular STRICTLY below this triggers stage4 dwell. */
    entryPopular: 15,
    /** Dwell turns required before collapse fires. */
    dwellTurns: 72,
  },
} as const;

// ── Dwell counter update ────────────────────────────────────────────────────

export interface DwellUpdateInputs {
  previous: DwellCounters;
  popularLegitimacy: number;
  partyConfidence: number;
  currentStage: RegimeStage;
  conventionInProgress: boolean;
  /**
   * Length of the sliding window for the stage2 cumulative counter.
   * Pulled in from the caller (test ergonomics + future tunability).
   */
  windowSizeTurns: number;
}

/**
 * Update all four dwell counters from this turn's scalar values.
 * Sliding-window semantics: stage2's `cumulativeIn168` erodes slowly
 * on recovery turns (every-other-turn -1) rather than resetting, so
 * a regime that escapes stage2 and re-enters re-enters faster
 * (institutional memory).
 *
 * Stage 4 counter is FROZEN while a convention is in progress
 * (Phase 6 suspends collapse during the negotiated transition).
 */
export function updateDwellCounters(inp: DwellUpdateInputs): DwellCounters {
  const next: DwellCounters = {
    stage1: inp.previous.stage1,
    stage2: {
      sustained: inp.previous.stage2.sustained,
      cumulativeIn168: inp.previous.stage2.cumulativeIn168,
    },
    stage3: inp.previous.stage3,
    stage4: inp.previous.stage4,
  };

  // Stage 1 — popular ≤ 60
  if (inp.popularLegitimacy <= STAGE_THRESHOLDS.stage1.entryPopular) {
    next.stage1 = inp.previous.stage1 + 1;
  } else {
    next.stage1 = Math.max(0, inp.previous.stage1 - 1);
  }

  // Stage 2 — popular ≤ 35 (both sustained + cumulative counters)
  if (inp.popularLegitimacy <= STAGE_THRESHOLDS.stage2.entryPopular) {
    next.stage2.sustained = inp.previous.stage2.sustained + 1;
    next.stage2.cumulativeIn168 = Math.min(
      inp.previous.stage2.cumulativeIn168 + 1,
      inp.windowSizeTurns
    );
  } else {
    next.stage2.sustained = Math.max(0, inp.previous.stage2.sustained - 1);
    // Cumulative erodes slowly: -1 every 4 recovery turns (24 turns of
    // sustained recovery erases ~6 ticks). Not a hard reset.
    if (inp.previous.stage2.cumulativeIn168 > 0 && inp.previous.stage2.cumulativeIn168 % 4 === 0) {
      next.stage2.cumulativeIn168 = inp.previous.stage2.cumulativeIn168 - 1;
    }
  }

  // Stage 3 — partyConfidence < 15
  if (inp.partyConfidence < STAGE_THRESHOLDS.stage3.entryPartyConfidence) {
    next.stage3 = inp.previous.stage3 + 1;
  } else {
    next.stage3 = Math.max(0, inp.previous.stage3 - 1);
  }

  // Stage 4 — popular < 15 AND already at internalChallenge/collapse,
  // AND no convention freezing the counter.
  if (inp.conventionInProgress) {
    next.stage4 = inp.previous.stage4; // frozen
  } else if (
    inp.popularLegitimacy < STAGE_THRESHOLDS.stage4.entryPopular &&
    (inp.currentStage === "internalChallenge" || inp.currentStage === "collapse")
  ) {
    next.stage4 = inp.previous.stage4 + 1;
  } else {
    next.stage4 = Math.max(0, inp.previous.stage4 - 1);
  }

  return next;
}

// ── Stage transition compute ────────────────────────────────────────────────

export interface StageInputs {
  popularLegitimacy: number;
  partyConfidence: number;
  dwellCounters: DwellCounters;
  currentStage: RegimeStage;
  conventionInProgress: boolean;
}

/**
 * Compute the next stage from current scalars + dwell counters. Pure +
 * forward-only — never regresses a stage on raw scalar recovery (that
 * requires an explicit Phase-4 decision-event handler to override).
 *
 * Evaluates highest-stage-first so a country that meets multiple stage
 * entry conditions in the same turn jumps directly to the most severe.
 */
export function computeNextStage(inp: StageInputs): RegimeStage {
  if (inp.currentStage === "collapse") return "collapse";

  // Stage 4: only reachable from internalChallenge; suspended by convention.
  if (
    !inp.conventionInProgress &&
    inp.popularLegitimacy < STAGE_THRESHOLDS.stage4.entryPopular &&
    inp.dwellCounters.stage4 >= STAGE_THRESHOLDS.stage4.dwellTurns &&
    inp.currentStage === "internalChallenge"
  ) {
    return "collapse";
  }

  // Stage 3: independent of popular; gates only on partyConfidence dwell.
  if (
    inp.partyConfidence < STAGE_THRESHOLDS.stage3.entryPartyConfidence &&
    inp.dwellCounters.stage3 >= STAGE_THRESHOLDS.stage3.dwellTurns &&
    rank(inp.currentStage) < rank("internalChallenge")
  ) {
    return "internalChallenge";
  }
  if (inp.currentStage === "internalChallenge") return "internalChallenge";

  // Stage 2: popular ≤ 35 with either sustained OR cumulative dwell trigger.
  if (
    inp.popularLegitimacy <= STAGE_THRESHOLDS.stage2.entryPopular &&
    (inp.dwellCounters.stage2.sustained >= STAGE_THRESHOLDS.stage2.dwellSustained ||
      inp.dwellCounters.stage2.cumulativeIn168 >= STAGE_THRESHOLDS.stage2.dwellCumulative) &&
    rank(inp.currentStage) < rank("crisis")
  ) {
    return "crisis";
  }
  if (inp.currentStage === "crisis") return "crisis";

  // Stage 1: popular ≤ 60 sustained for 12 turns.
  if (
    inp.popularLegitimacy <= STAGE_THRESHOLDS.stage1.entryPopular &&
    inp.dwellCounters.stage1 >= STAGE_THRESHOLDS.stage1.dwellTurns &&
    rank(inp.currentStage) < rank("discontent")
  ) {
    return "discontent";
  }
  if (inp.currentStage === "discontent") return "discontent";

  return "stable";
}

function rank(stage: RegimeStage): number {
  switch (stage) {
    case "stable":
      return 0;
    case "discontent":
      return 1;
    case "crisis":
      return 2;
    case "internalChallenge":
      return 3;
    case "collapse":
      return 4;
  }
}
