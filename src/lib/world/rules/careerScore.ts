import type { LegacyScoreBreakdown } from "../legacyLeaderboardTypes";

export const CAREER_SCORE_VERSION = 2;
export const CAREER_SCORE_MAX = 5_000;
export interface CareerScoreInputs {
  nationalInfluence: number;
  partyInfluence: number;
  achievementCount: number;
  highestOfficeRank: number;
  infamy: number;
  netWorthAnchor: number;
  enactedBills: number;
  contestWins: number;
  contestPodiums: number;
}
const positive = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
const progress = (n: number, scale: number, max: number) =>
  (max * positive(n)) / (positive(n) + scale);

/** Five bounded pillars. Account achievements are counted once, whichever life is ranked. */
export function computeCareerScore(input: CareerScoreInputs): {
  total: number;
  breakdown: LegacyScoreBreakdown;
} {
  const contestCredits = positive(input.contestWins) * 3 + positive(input.contestPodiums);
  const breakdown: LegacyScoreBreakdown = {
    nationalInfluence: progress(input.nationalInfluence, 1_000, 400),
    partyInfluence: progress(input.partyInfluence, 500, 200),
    officeTier: Math.min(8, positive(input.highestOfficeRank)) * 50,
    wealth: Math.min(1_000, Math.log10(1 + positive(input.netWorthAnchor) / 10_000) * 250),
    legislation: progress(input.enactedBills, 20, 1_000),
    contests: progress(contestCredits, 20, 1_000),
    achievements: progress(input.achievementCount, 20, 1_000),
    infamyPenalty: -Math.min(500, positive(input.infamy) * 5),
  };
  return {
    total: Math.max(
      0,
      Object.values(breakdown).reduce((sum, n) => sum + n, 0)
    ),
    breakdown,
  };
}
