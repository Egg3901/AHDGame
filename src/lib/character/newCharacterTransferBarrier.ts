import { MS_PER_TURN } from "@/lib/constants/turnTime";

/** New characters cannot send money to other characters for this many turns. */
export const NEW_CHARACTER_TRANSFER_BARRIER_TURNS = 24;

const BARRIER_MS = NEW_CHARACTER_TRANSFER_BARRIER_TURNS * MS_PER_TURN;

export interface NewCharacterTransferBarrierInput {
  /** Turn the character was created on. Turn-first source for the barrier. */
  createdTurn?: number | null;
  /** Creation instant. Legacy fallback when `createdTurn` is absent. */
  createdAt?: Date | string | null;
}

export interface NewCharacterTransferBarrierStatus {
  blocked: boolean;
  /** Whole turns remaining before sending is allowed; 0 when not blocked. */
  remainingTurns: number;
}

const NOT_BLOCKED: NewCharacterTransferBarrierStatus = { blocked: false, remainingTurns: 0 };

/**
 * Whether a character is still inside its 24-turn post-creation transfer barrier.
 * Turn-first (`createdTurn` + 24 turns); falls back to the `createdAt` Date only
 * when the turn field is absent (documents created before the field shipped).
 * Pure: callers pass `currentTurn` and the game clock's effective-now in ms.
 */
export function getNewCharacterTransferBarrier(
  input: NewCharacterTransferBarrierInput,
  currentTurn: number,
  effectiveNowMs: number
): NewCharacterTransferBarrierStatus {
  if (input.createdTurn != null) {
    const remainingTurns = input.createdTurn + NEW_CHARACTER_TRANSFER_BARRIER_TURNS - currentTurn;
    if (remainingTurns <= 0) return NOT_BLOCKED;
    return { blocked: true, remainingTurns };
  }

  if (input.createdAt) {
    const createdMs = new Date(input.createdAt).getTime();
    const elapsed = effectiveNowMs - createdMs;
    if (elapsed >= BARRIER_MS) return NOT_BLOCKED;
    return { blocked: true, remainingTurns: Math.ceil((BARRIER_MS - elapsed) / MS_PER_TURN) };
  }

  return NOT_BLOCKED;
}
