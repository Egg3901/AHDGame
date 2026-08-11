import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

/**
 * Allocation settings for a party organization — GOTV, suppression,
 * and org-building budget *percentages* (0-25) of each turn's revenue.
 *
 * Actual treasury funds live on politicalParties.treasury (national scope)
 * and statePartyOrg.treasury (state scope); the canonical chair pointer is
 * politicalParties.chairId / statePartyOrg.chairId. This collection holds
 * only the percentage allocations.
 *
 * gotvTargetCategory/gotvTargetGroup specify which single demographic to
 * target for GOTV. If not set, spending is spread across all eligible groups.
 * suppression* mirror that for voter suppression spend.
 */

interface PartyBudgetBase {
  _id: ObjectId;
  /** Party identifier (sequential ID string) */
  partyId: string;
  /** Country identifier to distinguish parties with same sequential ID across countries */
  countryId: CountryId;
  /** @deprecated Use gotvBudgetPercent instead. Absolute $ spent per turn on GOTV */
  gotvBudgetPerTurn: number;
  /** Percentage (0-25) of hourly revenue allocated to GOTV each turn */
  gotvBudgetPercent: number;
  /** Demographic category targeted for GOTV (e.g. "ideology", "race") */
  gotvTargetCategory?: string;
  /** Specific group targeted for GOTV (e.g. "evangelicals", "white") */
  gotvTargetGroup?: string;
  /** Percentage (0-25) of hourly revenue allocated to voter suppression each turn */
  suppressionBudgetPercent: number;
  /** Demographic category targeted for suppression */
  suppressionTargetCategory?: string;
  /** Specific group targeted for suppression */
  suppressionTargetGroup?: string;
  /** Percentage (0-25) of hourly revenue allocated to organization building each turn */
  orgBuildingPercent: number;
  /**
   * Percentage (0-25) of hourly revenue allocated to a voter-registration drive
   * each turn (player suggestion #81). Mirrors `gotvBudgetPercent`; converts to a
   * small, bounded per-state `StatePartyOrg.registration` boost drawn from the
   * state's non-party pool. Optional so legacy rows treat undefined as 0.
   */
  registrationBudgetPercent?: number;
  /** Soft treasury floor reserved for transfers to state or national branches */
  transferReserveAmount?: number;
  /** Soft treasury floor reserved for direct candidate/member support */
  memberSupportReserveAmount?: number;
  /** Soft treasury floor reserved for NPP recruiting or relocation actions */
  nppRecruitmentReserveAmount?: number;
  /** Stored Treasurer posture. "custom" means the Treasurer manually tuned the plan. */
  treasuryPreset?: TreasuryPresetId;
  createdAt: Date;
  updatedAt: Date;
}

export type PartyBudget =
  | (PartyBudgetBase & {
      /** Budget scope - national affects all states */
      scope: "national";
    })
  | (PartyBudgetBase & {
      /** Budget scope - state affects only one state */
      scope: "state";
      /** State identifier (e.g., "PA", "CA") - required for state budgets */
      stateId: string;
    });
