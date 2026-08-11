import type { CountryId } from "../../constants/countries";

/**
 * Per-region (state) government-approval rating with turn history.
 *
 * One document per state, written each turn by `snapshotApprovalHistory`
 * alongside the national `governmentApprovals` snapshot. Mirrors
 * {@link import("./governmentApproval").GovernmentApproval} at region scope so
 * the regional metrics tab can chart approval over time.
 *
 * The `history` array keeps the last 20 turns for charting.
 */
export interface StateApprovalHistory {
  /** State ID — used as the document _id */
  _id: string;
  stateId: string;
  countryId: CountryId;
  /** 0–100: this region's approval at the latest snapshot */
  approvalRating: number;
  /** Turn-by-turn history (most recent last, capped at 20 entries) */
  history: Array<{
    turn: number;
    approval: number;
    net: number;
  }>;
  updatedAt: Date;
}
