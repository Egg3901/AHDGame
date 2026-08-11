import type { CountryId } from "../../constants/countries";

/**
 * Country-level government approval rating.
 *
 * One document per country, updated each turn.
 *
 * Source is always "aggregate" — computed from state metrics compared to
 * national averages, not from any individual politician's favorability.
 *
 * The `history` array keeps the last 20 turns for charting.
 */
export interface GovernmentApproval {
  /** Country ID — used as the document _id */
  _id: CountryId;
  countryId: CountryId;
  /** 0–100: percentage of population approving the government */
  approvalRating: number;
  /** 0–100: percentage of population disapproving (computed as 100 − approvalRating) */
  disapprovalRating: number;
  /** approvalRating − disapprovalRating (can be negative) */
  netApproval: number;
  /**
   * How this value is derived each turn. Conceptually corresponds to
   * `getApprovalSourceForCountry(countryId)` (derived from
   * `CountryConfig.governmentType`); `"aggregate"` is retained for
   * backward compatibility with historical documents.
   */
  source: "president_favorability" | "pm_favorability" | "aggregate";
  /** Turn-by-turn history (most recent last, capped at 20 entries) */
  history: Array<{
    turn: number;
    approval: number;
    net: number;
  }>;
  updatedAt: Date;
}
