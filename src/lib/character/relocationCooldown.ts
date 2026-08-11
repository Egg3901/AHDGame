import { MS_PER_TURN, TURNS_PER_DAY } from "@/lib/constants/turnTime";

/** Relocation cooldown length. 72 turns = 72 game-hours = 3 real days. */
export const RELOCATION_COOLDOWN_TURNS = 72;
/** Cooldown length in whole days, for day-granular display (72 / 24 = 3). */
export const RELOCATION_COOLDOWN_DAYS = RELOCATION_COOLDOWN_TURNS / TURNS_PER_DAY;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LEGACY_COOLDOWN_MS = RELOCATION_COOLDOWN_TURNS * MS_PER_TURN;

export interface RelocationCooldownInput {
  lastRelocatedTurn?: number | null;
  lastRelocatedAt?: Date | string | null;
}

export interface RelocationCooldownStatus {
  onCooldown: boolean;
  /** Whole turns remaining; 0 when not on cooldown. */
  remainingTurns: number;
  /** Days remaining (ceil); null when not on cooldown. */
  cooldownRemainingDays: number | null;
  /** Projected ISO end instant (from real time, drift-immune); null when not on cooldown. */
  cooldownUntil: string | null;
}

const NOT_ON_COOLDOWN: RelocationCooldownStatus = {
  onCooldown: false,
  remainingTurns: 0,
  cooldownRemainingDays: null,
  cooldownUntil: null,
};

/**
 * Relocation cooldown status. Turn-first (`lastRelocatedTurn` + 72 turns); falls
 * back to the legacy `lastRelocatedAt` Date only when the turn field is absent.
 * `cooldownUntil` is projected from `realNowMs` so it doesn't drift.
 */
export function getRelocationCooldownStatus(
  input: RelocationCooldownInput,
  currentTurn: number,
  effectiveNowMs: number,
  realNowMs: number
): RelocationCooldownStatus {
  if (input.lastRelocatedTurn != null) {
    const remainingTurns = input.lastRelocatedTurn + RELOCATION_COOLDOWN_TURNS - currentTurn;
    if (remainingTurns <= 0) return NOT_ON_COOLDOWN;
    return {
      onCooldown: true,
      remainingTurns,
      cooldownRemainingDays: Math.ceil(remainingTurns / TURNS_PER_DAY),
      cooldownUntil: new Date(realNowMs + remainingTurns * MS_PER_TURN).toISOString(),
    };
  }

  if (input.lastRelocatedAt) {
    const lastMs = new Date(input.lastRelocatedAt).getTime();
    const elapsed = effectiveNowMs - lastMs;
    if (elapsed >= LEGACY_COOLDOWN_MS) return NOT_ON_COOLDOWN;
    const remainingMs = LEGACY_COOLDOWN_MS - elapsed;
    return {
      onCooldown: true,
      remainingTurns: Math.ceil(remainingMs / MS_PER_TURN),
      cooldownRemainingDays: Math.ceil(remainingMs / MS_PER_DAY),
      cooldownUntil: new Date(lastMs + LEGACY_COOLDOWN_MS).toISOString(),
    };
  }

  return NOT_ON_COOLDOWN;
}
