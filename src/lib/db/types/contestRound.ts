import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Weekly contests. Each kind runs one round at a time; when a round ends the
 * winner is paid and the next round starts from a fresh baseline.
 *
 * - corp_growth_small / corp_growth_large: percent growth in market cap of a
 *   player-run private corporation, net of capital injected during the round.
 *   The two tiers split the field at the median opening value.
 * - influence_gain: National Influence gained by a player character.
 * - approval_gain: approval points gained by a country whose head of
 *   government is a player and held office for the whole round.
 * - referrals_weekly: new players a referrer brought in during the round.
 * - legislator_bills: bills a player sponsored that were enacted during the round.
 * - wealth_growth: percent growth in a player's net worth, net of wires and loans.
 * - party_growth: members gained by a party with a player chair.
 */
export type ContestKind =
  | "corp_growth_small"
  | "corp_growth_large"
  | "influence_gain"
  | "approval_gain"
  | "referrals_weekly"
  | "legislator_bills"
  | "wealth_growth"
  | "party_growth";

/**
 * The iteration referral contest is not a weekly round: it runs from one
 * iteration change to the next, and its top three earn Supporter.
 */
export type ContestRecordKind = ContestKind | "referrals_iteration";

export interface ContestBaseline {
  /** Corporation id, character id, or country id, depending on kind. */
  subjectId: string;
  /** Opening value: local market cap, National Influence, or approval rating. */
  value: number;
  /** Player character the entry belongs to at the opening snapshot. */
  characterId: string;
  /** Capital injected into the corporation since the round opened (corp kinds only). */
  injected?: number;
}

export interface ContestStanding {
  subjectId: string;
  subjectName: string;
  characterId: string;
  characterName: string;
  baseline: number;
  current: number;
  /** Percent growth for corp kinds, absolute gain otherwise. */
  score: number;
}

export interface ContestWinner {
  characterId: string;
  characterName: string;
  subjectId: string;
  subjectName: string;
  score: number;
  /** Cash prize in ₳ (weekly kinds). */
  prizeAnchor?: number;
  prizeLocal?: number;
  currencyCode?: CurrencyCode;
  paidAt?: Date;
  /** Referral awards: user already had paid supporter benefits, so nothing changed. */
  alreadySupporter?: boolean;
  rank?: number;
}

export interface ContestRound {
  /** `${kind}:${roundNumber}`. A deterministic id makes a duplicate round start a duplicate-key no-op. */
  _id: string;
  kind: ContestRecordKind;
  roundNumber: number;
  status: "active" | "settled" | "void";
  startedAt: Date;
  endsAt: Date;
  startTurn: number;
  /** `type:number` of the iteration the round ran in; a round from another iteration is voided. */
  iterationKey?: string;
  /** Corp tiers: opening value boundary in ₳ between small and large. */
  tierBoundaryAnchor?: number;
  baselines: ContestBaseline[];
  standings: ContestStanding[];
  standingsTurn?: number;
  refreshedAt?: Date;
  settledAt?: Date;
  settledTurn?: number;
  winners: ContestWinner[];
  /** Referral awards only: who granted them. */
  awardedBy?: string;
  /** Referral awards only: user id of each winner. */
  winnerUserIds?: ObjectId[];
}
