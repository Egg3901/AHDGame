import {
  calculateFavorabilityAboveThresholdPenalty,
  calculateNationalInfluenceGain,
  calculatePoliticalInfluenceDecay,
} from "@shared/constants/formulas";

/**
 * Per-turn changes for the figures the phone widgets show. Character figures
 * are the per-turn rates the profile page shows (influence decay, national
 * influence gain, favorability cooling, projected campaign income). Corporation
 * and election figures are the change between the two latest recorded turns.
 * Null means the change is unknown, not zero.
 */
export interface WidgetPerTurn {
  funds: number | null;
  politicalInfluence: number | null;
  nationalInfluence: number | null;
  favorability: number | null;
  voteShare: number | null;
  sharePrice: number | null;
  marketCap: number | null;
  liquidCapital: number | null;
}

export interface WidgetPerTurnInput {
  /** Absent for imperial characters, who have no political standing. */
  character?: {
    politicalInfluence: number;
    favorability: number;
    /** Highest position-based national influence tier (resolvePositionNiBonus). */
    positionNiBonus: number;
    /** Projected campaign funds per turn, in the campaign currency. */
    fundsPerTurn: number | null;
  };
  corporationHistory?: readonly {
    sharePrice: number;
    liquidCapital: number;
    marketCap?: number;
  }[];
  electionHistory?: readonly { pct: number }[];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function latestChange<T>(rows: readonly T[] | undefined, pick: (row: T) => number | undefined) {
  if (!rows || rows.length < 2) return null;
  const current = pick(rows[rows.length - 1]);
  const previous = pick(rows[rows.length - 2]);
  if (current == null || previous == null) return null;
  return finiteOrNull(current - previous);
}

export function buildWidgetPerTurn(input: WidgetPerTurnInput): WidgetPerTurn {
  const character = input.character;
  return {
    funds: finiteOrNull(character?.fundsPerTurn),
    politicalInfluence: character
      ? finiteOrNull(-calculatePoliticalInfluenceDecay(character.politicalInfluence))
      : null,
    nationalInfluence: character
      ? finiteOrNull(
          calculateNationalInfluenceGain(character.politicalInfluence) + character.positionNiBonus
        )
      : null,
    favorability: character
      ? finiteOrNull(-calculateFavorabilityAboveThresholdPenalty(character.favorability))
      : null,
    voteShare: latestChange(input.electionHistory, (row) => row.pct),
    sharePrice: latestChange(input.corporationHistory, (row) => row.sharePrice),
    marketCap: latestChange(input.corporationHistory, (row) => row.marketCap),
    liquidCapital: latestChange(input.corporationHistory, (row) => row.liquidCapital),
  };
}
