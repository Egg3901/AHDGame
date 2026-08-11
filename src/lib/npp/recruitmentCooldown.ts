import { MS_PER_TURN } from "@/lib/constants/turnTime";

/** NPP recruitment cooldown length: 24 turns = 24 game-hours. */
export const RECRUITMENT_COOLDOWN_TURNS = 24;

export interface RecruitmentCooldownDoc {
  nppRecruitmentCooldownUntilTurn?: number | null;
  nppRecruitmentCooldownUntil?: Date | string | null;
}

/**
 * Whole turns remaining on the recruitment cooldown (0 = ready). Turn-first
 * (`nppRecruitmentCooldownUntilTurn`); falls back to the legacy Date only when
 * the turn field is absent.
 */
export function recruitmentCooldownRemainingTurns(
  doc: RecruitmentCooldownDoc | null | undefined,
  currentTurn: number,
  gameNowMs: number
): number {
  if (!doc) return 0;
  if (doc.nppRecruitmentCooldownUntilTurn != null) {
    return Math.max(0, doc.nppRecruitmentCooldownUntilTurn - currentTurn);
  }
  if (doc.nppRecruitmentCooldownUntil) {
    const remainingMs = new Date(doc.nppRecruitmentCooldownUntil).getTime() - gameNowMs;
    return remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_TURN) : 0;
  }
  return 0;
}

/** Fields to `$set` when a recruitment starts a fresh 24-turn cooldown. */
export function recruitmentCooldownSet(
  currentTurn: number,
  gameNowMs: number
): { nppRecruitmentCooldownUntil: Date; nppRecruitmentCooldownUntilTurn: number } {
  return {
    nppRecruitmentCooldownUntil: new Date(gameNowMs + RECRUITMENT_COOLDOWN_TURNS * MS_PER_TURN),
    nppRecruitmentCooldownUntilTurn: currentTurn + RECRUITMENT_COOLDOWN_TURNS,
  };
}

/**
 * Mongo filter fragment matching docs whose recruitment cooldown is READY
 * (expired or never set). Turn-first; the Date branch only applies to legacy
 * docs with no turn field. Spread into the atomic deduct `updateOne` query.
 */
export function recruitmentCooldownReadyFilter(
  currentTurn: number,
  gameNow: Date
): Record<string, unknown> {
  return {
    $or: [
      { nppRecruitmentCooldownUntilTurn: { $lte: currentTurn } },
      {
        nppRecruitmentCooldownUntilTurn: { $exists: false },
        $or: [
          { nppRecruitmentCooldownUntil: { $exists: false } },
          { nppRecruitmentCooldownUntil: { $lte: gameNow } },
        ],
      },
    ],
  };
}

/** Projected ISO end instant from real time (drift-immune); null when ready. */
export function recruitmentCooldownUntilIso(
  remainingTurns: number,
  realNowMs: number
): string | null {
  if (remainingTurns <= 0) return null;
  return new Date(realNowMs + remainingTurns * MS_PER_TURN).toISOString();
}
