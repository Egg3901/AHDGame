/**
 * Coverage-backed advertising agreements (issues #2235/#2125 slice).
 *
 * A buyer allocates part of its `marketingBudget` to a named Media and
 * Entertainment supplier. The allocation partitions the budget: it is never
 * an extra expense, and settlement attribution only splits the spend the
 * corporation turn already settles. Unallocated budget clears anonymously at
 * neutral efficacy (spot).
 */
export const ADVERTISING_AGREEMENTS_COLLECTION = "advertisingAgreements";
export const ADVERTISING_SETTLEMENTS_COLLECTION = "advertisingSettlements";

export const AD_AGREEMENT_INDEX_PARTIES = "ad_agreement_parties_v1";
export const AD_AGREEMENT_INDEX_BUYER_STATUS = "ad_agreement_buyer_status_v1";
export const AD_SETTLEMENT_INDEX_CORP_TURN = "ad_settlement_corp_turn_v1";

export type AdvertisingAgreementStatus =
  "pending" | "active" | "cancelling" | "cancelled" | "expired";

/** One revision in an advertising-agreement negotiation. */
export interface AdvertisingAgreementOffer {
  /** Monotonic within one agreement, starting at 1. */
  revision: number;
  /** Corporation that authored this offer, as a hex string. */
  proposedByCorpId: string;
  /** Share of the buyer's marketing budget, in basis points (1-10000). */
  allocationShareBps: number;
  /** Optional fixed term in turns. Absent means open-ended once accepted. */
  durationTurns?: number;
  /** Turn at which the offer was made, when the world turn was available. */
  proposedAtTurn?: number;
  proposedAt: Date;
}

/**
 * Bilateral advertising agreement. A supplier commits coverage-backed
 * advertising delivery against a share of the buyer's marketing budget; the
 * buyer's spend is attributed (never duplicated) and its efficacy follows
 * the supplier's delivery and coverage overlap.
 *
 * Gated by gameConfig.corporationProductsEnabled, the same flag as products.
 */
export interface AdvertisingAgreement {
  _id?: string;
  buyerCorpId: string;
  supplierCorpId: string;
  /** Accepted share of the buyer's marketing budget, in basis points. */
  allocationShareBps: number;
  /** Optional fixed term in turns. */
  durationTurns?: number;
  /** Turn on which an accepted fixed-term agreement starts settling. */
  startsAtTurn?: number;
  /** Turn on which an accepted fixed-term agreement stops settling. */
  expiresAtTurn?: number;
  status: AdvertisingAgreementStatus;
  /** Turn on which a `cancelling` agreement stops settling. Absent otherwise. */
  cancelEffectiveTurn?: number;
  proposedByCorpId: string;
  /** Latest offer, including the accepted offer on active agreements. */
  currentOffer?: AdvertisingAgreementOffer;
  /** Complete offer history, including the current offer. */
  offers?: AdvertisingAgreementOffer[];
  /** Latest turn this agreement was evaluated for delivery attribution. */
  lastSettlementTurn?: number;
  /** Buyer spend covered by supplier delivery last turn, anchor basis. */
  lastCoveredSpendAnchor?: number;
  /** Effective advertising attributed last turn, anchor basis. */
  lastEffectiveAnchor?: number;
  /** Coverage overlap used last turn, 0-1. */
  lastOverlap?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Per-corporation per-turn advertising settlement, readable by UI and tests. */
export interface AdvertisingSettlement {
  _id?: string;
  corporationId: string;
  turn: number;
  /** Marketing cash actually settled this turn, anchor basis. */
  settledSpendAnchor: number;
  /** Of that, spend under active agreements, anchor basis. */
  contractedSpendAnchor: number;
  /** Of that, unallocated (spot) spend, anchor basis. */
  spotSpendAnchor: number;
  /** Effective delivered advertising for the product lifecycle, anchor basis. */
  effectiveAdvertisingAnchor: number;
  lines: AdvertisingSettlementLine[];
  updatedAt: Date;
}

export interface AdvertisingSettlementLine {
  supplierCorpId: string;
  allocationShareBps: number;
  /** Revenue-weighted coverage overlap, 0-1. */
  overlap: number;
  /** Contracted spend covered by actual supplier delivery, anchor basis. */
  coveredSpendAnchor: number;
  effectiveAnchor: number;
}

/** Minimum fixed term for an advertising agreement, in turns. */
export const AD_AGREEMENT_DURATION_MIN_TURNS = 4;
/** Maximum fixed term for an advertising agreement, in turns. */
export const AD_AGREEMENT_DURATION_MAX_TURNS = 192;
/** Turns of notice a live advertising agreement takes to cancel. */
export const AD_AGREEMENT_CANCEL_NOTICE_TURNS = 4;
/** Full marketing budget in basis points; active shares may not exceed this. */
export const AD_AGREEMENT_BUDGET_BPS = 10000;
/** Smallest allocatable share: 1% of the buyer's marketing budget. */
export const AD_AGREEMENT_MIN_SHARE_BPS = 100;

/** True when an agreement settles delivery on the given turn. */
export function isAgreementSettling(
  agreement: Pick<
    AdvertisingAgreement,
    "status" | "startsAtTurn" | "expiresAtTurn" | "cancelEffectiveTurn"
  >,
  turn: number
): boolean {
  if (agreement.status !== "active" && agreement.status !== "cancelling") return false;
  if (!Number.isFinite(turn)) return false;
  if (agreement.startsAtTurn !== undefined && turn < agreement.startsAtTurn) return false;
  if (agreement.expiresAtTurn !== undefined && turn >= agreement.expiresAtTurn) return false;
  if (
    agreement.status === "cancelling" &&
    agreement.cancelEffectiveTurn !== undefined &&
    turn >= agreement.cancelEffectiveTurn
  ) {
    return false;
  }
  return true;
}
