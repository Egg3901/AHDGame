import type { ObjectId } from "mongodb";

/**
 * A decaying sentiment pulse created by a policy event.
 *
 * Current impact at time `now`:
 *   intervalsSince = floor((now - createdAt) / 900_000)
 *   impact = initialImpact × decayRate ^ intervalsSince
 *
 * A TTL index on `createdAt` (expireAfterSeconds = 86400) deletes
 * pulses after 24 hours — by then every pulse has decayed to < 0.1%.
 */
export interface SentimentPulse {
  _id: ObjectId;
  /** Which corps does this pulse affect? */
  scope: "all" | "country" | "sector" | "corp";
  /** countryId when scope = "country", or operating-country filter for sector pulses */
  countryId?: string;
  /** CorporationType string when scope = "sector" */
  sectorType?: string;
  /**
   * Optional HQ-country filter for sector pulses.
   * - domestic: only corps HQ'd in pulse.countryId
   * - foreign:  only corps HQ'd outside pulse.countryId
   */
  hqRelation?: "domestic" | "foreign";
  /** Corp _id string when scope = "corp" */
  corpId?: string;
  /** Signed decimal. e.g. -0.20 = −20%, +0.08 = +8% */
  initialImpact: number;
  /** Multiplier applied per 15-minute price-update interval. e.g. 0.80 */
  decayRate: number;
  /** When the underlying event fired. TTL index set to expire after 24 h. */
  createdAt: Date;
  /** Human-readable tag for debugging/display. */
  eventType: string;
}
