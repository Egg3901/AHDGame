import { getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import {
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonusBreakdown,
} from "./officeActionBonus";

/** One labeled line in the Political Standing action breakdown. */
export interface ActionBreakdownItem {
  label: string;
  amount: number;
}

export interface GetActionBreakdownArgs {
  /** `character.currentOffice?.type` (may be a cabinet key if appointed). */
  currentOfficeType: string | undefined;
  /** Legislative-seat office type from `electedOfficials` (recovers the seat when overwritten). */
  electedSeatOfficeType: string | undefined;
  /** Whether the character holds a seat in the unified `cabinetMembers` collection. */
  isCabinetMember: boolean;
  /** The character's cabinet `positionId` (for the cabinet line label). */
  cabinetPositionId: string | undefined;
  countryId: CountryId;
  officeActionBonus: Record<string, number> | undefined;
  baseActionsPerTurn: number;
  chairActionBonus: number;
  bonusActionsFromParty: number;
}

/**
 * Build the ordered, labeled per-source action breakdown for the Political
 * Standing tooltip: Base → Office (seat) → Cabinet (position) → Central Bank
 * Chair → Party influence. Zero-value sources are omitted. The seat and cabinet
 * bonuses come from {@link resolveOfficeActionBonusBreakdown} so the figures
 * match the turn processor exactly.
 */
export function getActionBreakdown({
  currentOfficeType,
  electedSeatOfficeType,
  isCabinetMember,
  cabinetPositionId,
  countryId,
  officeActionBonus,
  baseActionsPerTurn,
  chairActionBonus,
  bonusActionsFromParty,
}: GetActionBreakdownArgs): ActionBreakdownItem[] {
  const cabinetOfficeType = isCabinetMember ? cabinetOfficeTypeForCountry(countryId) : undefined;
  const { seatType, seatBonus, cabinetBonus } = resolveOfficeActionBonusBreakdown({
    currentOfficeType,
    electedSeatOfficeType,
    isCabinetMember,
    cabinetOfficeType,
    officeActionBonus,
  });

  const items: ActionBreakdownItem[] = [{ label: "Base", amount: baseActionsPerTurn }];

  if (seatBonus > 0) {
    const seatLabel = seatType ? getOfficeTypeConfig(countryId, seatType)?.label : undefined;
    items.push({ label: seatLabel ? `Office (${seatLabel})` : "Office", amount: seatBonus });
  }

  if (cabinetBonus > 0) {
    const positionName = cabinetPositionId
      ? getCabinetPositions(countryId).find((p) => p.id === cabinetPositionId)?.name
      : undefined;
    items.push({
      label: positionName ? `Cabinet (${positionName})` : "Cabinet",
      amount: cabinetBonus,
    });
  }

  if (chairActionBonus > 0) {
    items.push({ label: "Central Bank Chair", amount: chairActionBonus });
  }

  if (bonusActionsFromParty > 0) {
    items.push({ label: "Party influence", amount: bonusActionsFromParty });
  }

  return items;
}
