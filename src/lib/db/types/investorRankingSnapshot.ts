/**
 * Pre-computed global investor rankings, generated once per turn.
 * Avoids scanning all corporations when looking up a character's investor rank.
 */
export interface InvestorRanking {
  characterId: string;
  characterName: string;
  portfolioValue: number;
  rank: number;
}

export interface InvestorRankingSnapshot {
  /** Always "global" - single document */
  _id: "global";
  /** Turn when this snapshot was generated */
  turn: number;
  /** Top investors sorted by portfolio value descending */
  rankings: InvestorRanking[];
  /** Map of characterId -> portfolioValue for all investors (for quick lookup) */
  portfolioValues: Record<string, number>;
  /** When this snapshot was created */
  createdAt: Date;
}
