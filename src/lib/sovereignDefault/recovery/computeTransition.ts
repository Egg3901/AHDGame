/**
 * Pure recovery state-transition function (design 5.6).
 *
 * Steps per evaluation:
 *   1. Update fiscal-discipline streak (increment on good standing, else reset).
 *   2. Decrement GDP-penalty turn counter; clear penalty fields when it hits 0.
 *   3. If 48-turn floor reached AND 5-turn streak satisfied → exit recovery.
 *
 * On exit: state → "normal", recovery+lockout fields cleared, credit rating
 * reset to mid-tier (existing fiscal-year debt processing recomputes the real
 * rating from D/GDP next year). lastDefaultTurn is intentionally preserved —
 * the Phase 7 sector margin penalty window extends to turn 72.
 */

import type { SovereignCrisisState } from "@/lib/db/types/budget";
import {
  RECOVERY_FLOOR_TURNS,
  RECOVERY_DISCIPLINE_REQUIRED_STREAK,
  RECOVERY_CREDIBILITY_BONUS_TURNS,
} from "../constants";

export interface RecoveryTransitionInputs {
  currentState: SovereignCrisisState | undefined;
  recoveryStartedAtTurn: number | null;
  fiscalDisciplineStreak: number;
  inGoodStanding: boolean;
  currentTurn: number;
  recoveryGdpPenaltyTurnsRemaining: number | null;
}

export interface RecoveryTransitionOutput {
  set: Record<string, unknown>;
  exitedRecovery: boolean;
}

export function computeRecoveryTransition(
  input: RecoveryTransitionInputs
): RecoveryTransitionOutput {
  if (input.currentState !== "recovering") {
    return { set: {}, exitedRecovery: false };
  }
  if (input.recoveryStartedAtTurn === null) {
    return { set: {}, exitedRecovery: false };
  }

  const set: Record<string, unknown> = {};

  // 1. Fiscal-discipline streak.
  const nextStreak = input.inGoodStanding ? input.fiscalDisciplineStreak + 1 : 0;
  set.recoveryFiscalDisciplineStreak = nextStreak;

  // 2. GDP-penalty turn decrement (only when active).
  if (
    input.recoveryGdpPenaltyTurnsRemaining !== null &&
    input.recoveryGdpPenaltyTurnsRemaining > 0
  ) {
    const next = input.recoveryGdpPenaltyTurnsRemaining - 1;
    set.recoveryGdpPenaltyTurnsRemaining = next;
    if (next === 0) {
      set.recoveryGdpPenaltyPercent = null;
    }
  }

  // 3. Exit conditions.
  const turnsSinceStart = input.currentTurn - input.recoveryStartedAtTurn;
  const meetsFloor = turnsSinceStart >= RECOVERY_FLOOR_TURNS;
  const meetsStreak = nextStreak >= RECOVERY_DISCIPLINE_REQUIRED_STREAK;

  if (meetsFloor && meetsStreak) {
    set.sovereignCrisisState = "normal";
    set.recoveryStartedAt = null;
    set.marketAccessLockedUntilTurn = null;
    set.failedAuctionConsecutiveCount = 0;
    set.recoveryFiscalDisciplineStreak = 0;
    set.recoveryGdpPenaltyPercent = null;
    set.recoveryGdpPenaltyTurnsRemaining = null;
    set.creditRating = "BBB";
    // Phase 11a: stamp the credibility-bonus expiry so the sovereign coupon
    // calculation discounts the country's effective rate while it's active.
    // Reward for staying disciplined through full recovery.
    set.recoveryCredibilityBonusUntilTurn = input.currentTurn + RECOVERY_CREDIBILITY_BONUS_TURNS;
    // lastDefaultTurn intentionally preserved — Phase 7 sector margin penalty
    // window decay extends past the 48-turn formal recovery exit.
    return { set, exitedRecovery: true };
  }

  return { set, exitedRecovery: false };
}
