// Shared TypeScript interfaces/types for the State Party page and its sub-components.
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

export interface LeaderInfo {
  id: string;
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
}

export interface MemberInfo {
  id: string;
  name: string;
  homeState: string;
  currentOffice: { type: string; state?: string; seatsHeld?: number } | null;
  avatarUrl?: string;
  isNPP: boolean;
  sequentialId?: number;
}

export interface StatePartyData {
  _id: string;
  stateId: string;
  stateName: string;
  countryId: "US" | "UK" | "DE" | "JP" | "CN";
  politicalLean: number;
  statePopulation: number;
  partyId: string;
  partyName: string;
  partyColor: string;
  partyAbbreviation: string;
  partyLogoUrl?: string | null;
  isDefault: boolean;
  /** Regime status of the parent national party (one-party-state countries only). */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  organization: number;
  treasury: number;
  stateTaxRate: number;
  nationalTaxRate: number;
  expectedHourlyIncome: number;
  gotvBudgetPercent: number;
  gotvEstimatedSpend: number;
  gotvTargetCategory: string | null;
  gotvTargetGroup: string | null;
  suppressionBudgetPercent: number;
  suppressionEstimatedSpend: number;
  suppressionTargetCategory: string | null;
  suppressionTargetGroup: string | null;
  orgBuildingPercent: number;
  orgBuildingEstimatedSpend: number;
  /** Chair-set per-turn USD budget for explicit PS investment. 0 = off. */
  psInvestmentBudget: number;
  /**
   * @deprecated The "% of treasury" phantom-PS stream was removed in the
   * 2026-06-25 PS-building rebalance; the engine no longer reads this. Retained
   * for backward compatibility only.
   */
  /** Whether the party has a player or elected official in this state.
   *  Required for PS-spend Org actions (`hasPresence: false` blocks Build Org). */
  hasPresence: boolean;
  transferReserveAmount: number;
  memberSupportReserveAmount: number;
  nppRecruitmentReserveAmount: number;
  treasuryPreset: TreasuryPresetId;
  totalReserveTarget: number;
  discretionaryTreasury: number;
  netHourlyTreasuryChange: number;
  turnsUntilZero: number | null;
  turnsUntilReserveFloor: number | null;
  turnsToReachReserveFloor: number | null;
  economicPosition: number;
  socialPosition: number;
  politicalStrength: number;
  /** Effective PS cap denominator: 30 with a homed player member, else 7.5. */
  effectivePsCap?: number;
  heroImageUrl?: string;
  chair: LeaderInfo | null;
  viceChair: LeaderInfo | null;
  treasurer: LeaderInfo | null;
  /** Single chair-assigned campaigner for this state-party row. Null when unset. */
  campaigner: LeaderInfo | null;
  memberCount: number;
  members: MemberInfo[];
  /** Other parties with a state-party row here, sorted by Org desc. Powers the
   *  Contest panel on this page. Excludes the subject party. */
  rivals: Array<{ partyId: string; abbreviation: string; color?: string }>;
  nationalChairId: string | null;
  nationalViceChairId: string | null;
  /** Stringified ObjectIds of national party campaigners (up to 3). */
  nationalCampaignerIds: string[];
  /**
   * Presidential primary delegate-allocation method chosen by the state party chair.
   * null / undefined → uses family default (Dem=PR, GOP=WTA).
   * Frozen when a presidential primary is active for this country.
   */
  primaryAllocation?: "PR" | "WTA" | null;
  /**
   * True when a presidential primary is active in this country — the chair
   * cannot change allocation during this window (admins may override).
   */
  primaryAllocationLocked?: boolean;
  /**
   * Effective method in use right now: the chair's explicit choice if set,
   * otherwise the family default inferred from this party's position/abbreviation.
   */
  primaryAllocationEffective?: "PR" | "WTA";
  /** Whether the effective method is a chair-set override (vs default). */
  primaryAllocationIsExplicit?: boolean;
}

export interface UserData {
  username: string;
  isAdmin: boolean;
  isModerator?: boolean;
  hasCharacter: boolean;
  character?: { id: string; party: string; homeState: string; funds?: number };
}

export type Position = "chair" | "viceChair" | "treasurer";

export type MainTab =
  | "overview"
  | "analytics"
  | "whip-room"
  | "slate"
  | "actions"
  | "elections"
  | "treasury"
  | "members"
  | "discussion"
  | "admin";
