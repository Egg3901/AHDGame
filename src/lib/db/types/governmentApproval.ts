import type { CountryId } from "../../constants/countries";
import type { ActiveModifier } from "../../utils/approvalModifiers";

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
  /**
   * The war block's applied total as of the last snapshot.
   *
   * Persisted so the block can be damped as a block: national modifiers are
   * applied after per-state damping and are otherwise unbounded in rate, and
   * war exhaustion reaches -25. Absent is read as 0 rather than left undefined,
   * so a war predating this feature ramps in at the damping step instead of
   * landing whole on the first snapshot.
   */
  warApprovalTotal?: number;
  /**
   * The national modifiers behind `approvalRating`, as of the last snapshot.
   *
   * Stored rather than recomputed because the providers behind them are async
   * and read conflicts, personnel and org state — work that belongs in the turn
   * phase, not in a page render. Readers show these beside the stored rating.
   */
  activeNationalModifiers?: ActiveModifier[];
  updatedAt: Date;
}
