import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ExtractableResource } from "@/lib/constants/commodities";

export interface ExtractionContract {
  _id: ObjectId;
  stateId: string;
  countryId: CountryId;
  corporationId: ObjectId;
  resource: ExtractableResource;
  /** Fraction of state capacity reserved for this company, e.g. 0.5 = 50% */
  share: number;
  grantedTurn: number;
  /** The legislature ID that granted this contract */
  grantedBy: string;
  grantedByLevel: "state" | "national";
  /** Set to current turn when revoked; absent means active */
  revokedTurn?: number;
  /**
   * Lifecycle status (contract-issuance feature). ABSENT means a legacy /
   * admin-granted contract that is active as soon as it is non-revoked — those
   * predate the offer→accept flow and must keep allocating capacity. Only
   * `offered` and `declined` are excluded from the active-contract filter; a
   * `revokedTurn` is set for all terminal states (expired / defaulted / revoked
   * / declined). See activeExtractionContractFilter().
   */
  status?: "offered" | "active" | "declined" | "expired" | "defaulted";
  /** One-time signing fee (anchor units) charged to the corp on acceptance. */
  signingFeeAnchor?: number;
  /** Per-turn royalty as a fraction of contracted capacity market value (0–0.02). */
  royaltyRatePerTurn?: number;
  /** Contract term in turns; absent = perpetual (legacy / admin). */
  termTurns?: number;
  /** Turn the offer was accepted and the contract went active. */
  activatedTurn?: number;
  /** activatedTurn + termTurns; contract expires on the first turn >= this. */
  expiresTurn?: number;
  /** Offers lapse (status → expired) on the first turn >= this. */
  offerExpiresTurn?: number;
  /** Count of consecutive/total missed royalty payments; default at CONTRACT_DEFAULT_MISSED_PAYMENTS. */
  missedPayments?: number;
  /**
   * Last turn a royalty settlement outcome (paid OR missed) was recorded.
   * Idempotency marker: a retried contractSettlement phase skips contracts with
   * lastRoyaltyTurn >= turn so a re-run never double-charges.
   */
  lastRoyaltyTurn?: number;
  updatedAt: Date;
}
