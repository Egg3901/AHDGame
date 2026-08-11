import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Office-type keys used for cabinet appointments. A cabinet appointment
 * overwrites `character.currentOffice` with one of these keys (see
 * `cabinetOfficeFor` in the cabinet admin route and the PM/Senate seating
 * flows), discarding the holder's underlying legislative seat office type.
 */
export const CABINET_OFFICE_TYPES = new Set<string>([
  "parliamentaryCabinet",
  "ukCabinet",
  "usCabinet",
]);

/**
 * The cabinet office-type key for a country. US and UK have dedicated keys; all
 * other parliamentary systems share `parliamentaryCabinet`. Mirrors
 * `cabinetOfficeFor` in `src/app/api/admin/country/[code]/cabinet/route.ts`.
 */
export function cabinetOfficeTypeForCountry(countryId: CountryId): string {
  if (countryId === COUNTRY_CONFIGS.US.id) return "usCabinet";
  if (countryId === COUNTRY_CONFIGS.UK.id) return "ukCabinet";
  return "parliamentaryCabinet";
}

export interface ResolveOfficeActionBonusArgs {
  /** `character.currentOffice.type` (may be a cabinet key if appointed). */
  currentOfficeType: string | undefined;
  /**
   * The holder's legislative-seat office type from `electedOfficials`, used to
   * recover the seat bonus when `currentOfficeType` is a cabinet key (the seat
   * was overwritten on appointment). `undefined` when they hold no seat.
   */
  electedSeatOfficeType: string | undefined;
  /** Whether the character holds a seat in the unified `cabinetMembers` collection. */
  isCabinetMember: boolean;
  /** The country's cabinet office-type key (from {@link cabinetOfficeTypeForCountry}). */
  cabinetOfficeType: string | undefined;
  /** `gameConfig.officeActionBonus` map (office-type key → per-turn bonus). */
  officeActionBonus: Record<string, number> | undefined;
}

export interface OfficeActionBonusBreakdown {
  /** The resolved underlying-seat office type (cabinet keys excluded), or undefined. */
  seatType: string | undefined;
  /** Bonus from the legislative/executive seat. */
  seatBonus: number;
  /** Bonus from the cabinet seat (stacks on top of the seat bonus). */
  cabinetBonus: number;
}

/**
 * Resolve the seat/cabinet split of a character's per-turn office AP bonus.
 *
 * Cabinet bonuses STACK on top of the underlying legislative seat, mirroring
 * how the central-bank chair bonus stacks on an elected-office bonus. Because
 * cabinet appointment overwrites `currentOffice` with a cabinet key, the seat is
 * recovered from `electedSeatOfficeType` rather than `currentOffice`. The
 * overwritten cabinet key is counted exactly once (as `cabinetBonus`), never
 * doubled as the seat bonus.
 */
export function resolveOfficeActionBonusBreakdown({
  currentOfficeType,
  electedSeatOfficeType,
  isCabinetMember,
  cabinetOfficeType,
  officeActionBonus,
}: ResolveOfficeActionBonusArgs): OfficeActionBonusBreakdown {
  // When currentOffice is a cabinet key it is not a real seat — recover the
  // underlying legislative seat so its bonus is not lost.
  const seatType =
    currentOfficeType && CABINET_OFFICE_TYPES.has(currentOfficeType)
      ? electedSeatOfficeType
      : currentOfficeType;

  const seatBonus = seatType ? (officeActionBonus?.[seatType] ?? 0) : 0;
  const cabinetBonus =
    isCabinetMember && cabinetOfficeType ? (officeActionBonus?.[cabinetOfficeType] ?? 0) : 0;

  return { seatType, seatBonus, cabinetBonus };
}

/**
 * Resolve a character's total per-turn office AP bonus (seatBonus + cabinetBonus).
 * See {@link resolveOfficeActionBonusBreakdown} for the stacking semantics.
 */
export function resolveOfficeActionBonus(args: ResolveOfficeActionBonusArgs): number {
  const { seatBonus, cabinetBonus } = resolveOfficeActionBonusBreakdown(args);
  return seatBonus + cabinetBonus;
}
