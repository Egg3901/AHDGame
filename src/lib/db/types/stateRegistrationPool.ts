import type { CountryId } from "../../constants/countries";

/**
 * State-level non-party registration buckets.
 *
 * The registration pool in each state sums to 100% across:
 *   sum of all StatePartyOrg.registration[partyId] for parties in this country
 *   + StateRegistrationPool.independent
 *   + StateRegistrationPool.unregistered
 *   = 100
 *
 * Phase 1: schema added; no documents created yet (bootstrap backfill
 *   deferred to Phase 1.5 / Phase 2 prerequisite per plan D1).
 * Phase 3+: drift / decay / Reg actions mutate `independent` and
 *   `unregistered` per the politics turn-order contract.
 *
 * See docs/design/political-system-reg-support.md §4.3 for the full model.
 */
export interface StateRegistrationPool {
  /** Composite key: `${countryId}_${stateId}` (mirrors StatePartyOrg pattern). */
  _id: string;

  countryId: CountryId;
  stateId: string;

  /**
   * Politically engaged but unattached share. Moved primarily by persuasion,
   * candidate quality, scandals, endorsements, and issue salience.
   * Bounds: 0..100.
   */
  independent: number;

  /**
   * Lower-engagement population share. Primarily moved by registration /
   * civic-engagement actions.
   * Bounds: 0..100.
   */
  unregistered: number;

  /**
   * Last turn at which any share moved (matches `gameState.currentTurn`
   * semantics). Useful for change detection and for skipping renormalization
   * scans on quiet states.
   */
  lastUpdatedTurn: number;

  createdAt: Date;
  updatedAt: Date;
}
