import type { CountryId } from "@/lib/constants/countries";
import { JUSTICE_NI_BONUS_PER_TURN } from "@/lib/constants/justiceActions";
import type { LeadershipRole } from "@/lib/db/types/leadership";
import { cabinetOfficeTypeForCountry } from "../officeActionBonus";
import { resolveOfficeNiBonus } from "../officeBonusRegistry";

/**
 * Per-turn national-influence tiers for congressional leadership roles.
 * Position bonuses use the highest qualifying tier rather than stacking.
 */
export const CONGRESS_LEADER_NI_BONUS: Partial<Record<LeadershipRole, number>> = {
  majority_leader_senate: 2.0,
  speaker_of_the_house: 2.0,
  president_pro_tempore: 2.0,
  minority_leader_senate: 1.5,
  majority_leader_house: 1.5,
  minority_leader_house: 1.5,
};

export interface PositionNiBonusInput {
  currentOfficeType?: string;
  countryId: CountryId;
  congressLeadershipRoles?: readonly LeadershipRole[];
  isPartyChair?: boolean;
  isPartySubChair?: boolean;
  isSeatedJustice?: boolean;
  /**
   * Country of a live unified-cabinet membership. Membership is authoritative
   * for both confirmed and acting appointments, even when currentOffice still
   * points at another seat or is empty.
   */
  cabinetCountryId?: CountryId;
}

/** Resolve the highest position-based NPI tier a character qualifies for. */
export function resolvePositionNiBonus({
  currentOfficeType,
  countryId,
  congressLeadershipRoles = [],
  isPartyChair = false,
  isPartySubChair = false,
  isSeatedJustice = false,
  cabinetCountryId,
}: PositionNiBonusInput): number {
  let bonus = resolveOfficeNiBonus(currentOfficeType, countryId);

  for (const role of congressLeadershipRoles) {
    bonus = Math.max(bonus, CONGRESS_LEADER_NI_BONUS[role] ?? 0);
  }

  if (isPartyChair) {
    bonus = Math.max(bonus, 2.0);
  } else if (isPartySubChair) {
    bonus = Math.max(bonus, 1.5);
  }

  if (isSeatedJustice) {
    bonus = Math.max(bonus, JUSTICE_NI_BONUS_PER_TURN);
  }

  if (cabinetCountryId) {
    bonus = Math.max(
      bonus,
      resolveOfficeNiBonus(cabinetOfficeTypeForCountry(cabinetCountryId), cabinetCountryId)
    );
  }

  return bonus;
}
