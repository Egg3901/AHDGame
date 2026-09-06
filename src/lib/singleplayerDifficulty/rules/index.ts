import type { SingleplayerDifficulty } from "@/lib/db/types";

export interface SingleplayerNppTuning {
  /** Passive NPP action points granted by the existing fund phase. */
  actionPointsPerTurn: number;
  /** Maximum banked action points in the existing NPP fund phase. */
  actionPointCap: number;
  /** Multiplier on the existing donor-fund result. */
  fundMultiplier: number;
}

/** Live NPP fund-phase parity constants. Keep normal local play tied to these. */
export const NPP_ACTIONS_PER_TURN = 2;
export const NPP_ACTION_CAP = 100;

const TUNING: Record<SingleplayerDifficulty, SingleplayerNppTuning> = {
  easy: { actionPointsPerTurn: 1, actionPointCap: 50, fundMultiplier: 0.75 },
  normal: {
    actionPointsPerTurn: NPP_ACTIONS_PER_TURN,
    actionPointCap: NPP_ACTION_CAP,
    fundMultiplier: 1,
  },
  hard: { actionPointsPerTurn: 3, actionPointCap: 150, fundMultiplier: 1.25 },
};

export function singleplayerNppTuning(
  difficulty: SingleplayerDifficulty | undefined
): SingleplayerNppTuning {
  return TUNING[difficulty ?? "normal"];
}
