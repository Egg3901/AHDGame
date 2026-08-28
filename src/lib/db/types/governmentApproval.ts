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
   * The war block's applied total as of the last snapshot: the sum of the war
   * chips, nothing more. No longer a damped quantity in its own right — every
   * term is now either a slow integrator or bounded and recomputed, so the block
   * has nothing left that can jump.
   *
   * Written for diagnostics and read by nothing. The snapshot decides when a
   * non-playable belligerent's document can be released from `warExhaustion`
   * instead: this total rounds to a tenth for display, so it reads zero while a
   * real residue is still healing.
   */
  warApprovalTotal?: number;
  /**
   * War exhaustion, as a running integrator rather than a function of the
   * current war's clock.
   *
   * Moves one point per in-game year: down while the country is fighting, up
   * toward a ceiling of zero while it is at peace. Persisted BECAUSE it outlives
   * its war. Ending a war and immediately starting another used to reset
   * exhaustion to its opening +1, so a government could fight continuously and
   * never pay for it; the residue now carries across and the rally on entry is
   * capped at +1 rather than granted outright.
   *
   * Absent means "never scored". The first snapshot of a country already at war
   * seeds this from the original closed-form curve, so nothing jumps the day it
   * ships and no backfill script is needed.
   */
  warExhaustion?: number;
  /**
   * The conflict `warExhaustion` was last accrued against.
   *
   * The rally on entering a new war keys on this changing, rather than on
   * `turnsSinceEntry === 0`: a turn the snapshot did not run for this country
   * would otherwise swallow the transition silently, and ending one war and
   * opening another on the same turn would be missed entirely.
   */
  warExhaustionConflictId?: string | null;
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
