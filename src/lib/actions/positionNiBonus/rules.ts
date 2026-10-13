import type { CountryId } from "@/lib/constants/countries";
import { JUSTICE_NI_BONUS_PER_TURN } from "@/lib/constants/justiceActions";
import type { LeadershipRole } from "@/lib/db/types/leadership";
import { cabinetOfficeTypeForCountry } from "../officeActionBonus";
import {
  ACTING_CABINET_NI_BONUS,
  CABINET_NI_BONUS,
  resolveOfficeNiBonus,
} from "../officeBonusRegistry";

/**
 * Per-turn national-influence tiers for chamber leadership roles. Position
 * bonuses use the highest qualifying tier rather than stacking. Whips sit at
 * the rank-and-file legislator tier, so they gain nothing here.
 */
export const CONGRESS_LEADER_NI_BONUS: Partial<Record<LeadershipRole, number>> = {
  speaker_of_the_house: 2.0,
  speaker_of_the_bundestag: 2.0,
  chair_npcsc: 2.0,
  speaker_ng_reps: 2.0,
  president_ng_senate: 2.0,
  president_pro_tempore: 2.0,
  majority_leader_senate: 2.0,
  majority_leader_house: 2.0,
  minority_leader_senate: 1.5,
  minority_leader_house: 1.5,
  chair_cppcc: 1.5,
};

/**
 * Per-turn action bonus for chamber leadership. Stacks on the holder's seat;
 * a character holding several leadership roles takes the highest only.
 * Presiding officers run the floor, the party leaders on both sides fight it,
 * and the remaining officers carry a smaller load.
 */
export const LEADERSHIP_ACTION_BONUS: Partial<Record<LeadershipRole, number>> = {
  speaker_of_the_house: 3,
  speaker_of_the_bundestag: 3,
  chair_npcsc: 3,
  speaker_ng_reps: 3,
  president_ng_senate: 3,
  majority_leader_senate: 2,
  majority_leader_house: 2,
  minority_leader_senate: 2,
  minority_leader_house: 2,
  president_pro_tempore: 1,
  chair_cppcc: 1,
  majority_whip_house: 1,
  minority_whip_house: 1,
  majority_whip_senate: 1,
  minority_whip_senate: 1,
};

/** Leader of the Opposition: same floor role as a minority leader. */
export const OPPOSITION_LEADER_ACTION_BONUS = 2;
/** Shadow cabinet member: mirrors the cabinet's +1. */
export const SHADOW_CABINET_ACTION_BONUS = 1;
/** Seated Supreme Court justice: stacks on any other office held. */
export const JUSTICE_ACTION_BONUS = 2;

export interface LeadershipActionBonusInput {
  congressLeadershipRoles?: readonly LeadershipRole[];
  isOppositionLeader?: boolean;
  isShadowCabinetMember?: boolean;
}

/** Highest chamber-leadership AP bonus a character qualifies for. */
export function resolveLeadershipActionBonus({
  congressLeadershipRoles = [],
  isOppositionLeader = false,
  isShadowCabinetMember = false,
}: LeadershipActionBonusInput): number {
  let bonus = 0;
  for (const role of congressLeadershipRoles) {
    bonus = Math.max(bonus, LEADERSHIP_ACTION_BONUS[role] ?? 0);
  }
  if (isOppositionLeader) bonus = Math.max(bonus, OPPOSITION_LEADER_ACTION_BONUS);
  if (isShadowCabinetMember) bonus = Math.max(bonus, SHADOW_CABINET_ACTION_BONUS);
  return bonus;
}

/** Party offices. */
export const PARTY_CHAIR_NI_BONUS = 2.0;
export const PARTY_SUB_CHAIR_NI_BONUS = 1.5;
export const STATE_PARTY_CHAIR_NI_BONUS = 0.5;
/** Central bank chair: the cabinet tier. */
export const CENTRAL_BANK_CHAIR_NI_BONUS = CABINET_NI_BONUS;

/** CEO of one of the 10 largest listed corporations in their country. */
export const MAJOR_CEO_NI_BONUS = 0.3;
/** CEO of any other qualifying corporation. */
export const CEO_NI_BONUS = 0.15;
export type CeoNiTier = "major" | "standard";

/**
 * Leading an international organisation is a separate stage from domestic
 * office, so it adds on top of the domestic tier instead of competing with it.
 */
export const ORG_HEAD_NI_BONUS = 1.0;

export interface PositionNiBonusInput {
  currentOfficeType?: string;
  countryId: CountryId;
  congressLeadershipRoles?: readonly LeadershipRole[];
  isPartyChair?: boolean;
  isPartySubChair?: boolean;
  isStatePartyChair?: boolean;
  isSeatedJustice?: boolean;
  isCentralBankChair?: boolean;
  /**
   * Country of a live unified-cabinet membership. Membership is authoritative
   * for both confirmed and acting appointments, even when currentOffice still
   * points at another seat or is empty.
   */
  cabinetCountryId?: CountryId;
  /** The cabinet membership is an acting appointment. */
  isActingCabinet?: boolean;
  ceoTier?: CeoNiTier | null;
  /** Holds an international organisation's leadership seat. */
  isOrgHead?: boolean;
}

/** Resolve the highest domestic NI tier plus any international add-on. */
export function resolvePositionNiBonus({
  currentOfficeType,
  countryId,
  congressLeadershipRoles = [],
  isPartyChair = false,
  isPartySubChair = false,
  isStatePartyChair = false,
  isSeatedJustice = false,
  isCentralBankChair = false,
  cabinetCountryId,
  isActingCabinet = false,
  ceoTier = null,
  isOrgHead = false,
}: PositionNiBonusInput): number {
  // Acting appointments overwrite currentOffice with the cabinet key, so the
  // office tier would otherwise grant the confirmed rate.
  const officeTierIsCabinet =
    cabinetCountryId != null && currentOfficeType === cabinetOfficeTypeForCountry(cabinetCountryId);
  let bonus =
    isActingCabinet && officeTierIsCabinet ? 0 : resolveOfficeNiBonus(currentOfficeType, countryId);

  for (const role of congressLeadershipRoles) {
    bonus = Math.max(bonus, CONGRESS_LEADER_NI_BONUS[role] ?? 0);
  }

  if (isPartyChair) {
    bonus = Math.max(bonus, PARTY_CHAIR_NI_BONUS);
  } else if (isPartySubChair) {
    bonus = Math.max(bonus, PARTY_SUB_CHAIR_NI_BONUS);
  }
  if (isStatePartyChair) bonus = Math.max(bonus, STATE_PARTY_CHAIR_NI_BONUS);

  if (isSeatedJustice) bonus = Math.max(bonus, JUSTICE_NI_BONUS_PER_TURN);
  if (isCentralBankChair) bonus = Math.max(bonus, CENTRAL_BANK_CHAIR_NI_BONUS);

  if (cabinetCountryId) {
    bonus = Math.max(bonus, isActingCabinet ? ACTING_CABINET_NI_BONUS : CABINET_NI_BONUS);
  }

  if (ceoTier === "major") bonus = Math.max(bonus, MAJOR_CEO_NI_BONUS);
  else if (ceoTier === "standard") bonus = Math.max(bonus, CEO_NI_BONUS);

  return bonus + (isOrgHead ? ORG_HEAD_NI_BONUS : 0);
}
