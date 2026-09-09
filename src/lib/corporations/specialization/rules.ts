/**
 * Corporate specialization rewards sectors in the company's chosen industries.
 * The operating bonus reduces costs without lowering the payroll cost basis.
 */
export const SECTOR_TYPE_MATCH_BONUS = 10;
export const SECTOR_TYPE_SECONDARY_MATCH_BONUS = 5;
export const SECTOR_TYPE_MISMATCH_PENALTY = -15;

export function getSectorTypeMatchModifier(
  sectorType: string,
  corporationType: string,
  secondaryType?: string | null
): number {
  if (sectorType === corporationType) return SECTOR_TYPE_MATCH_BONUS;
  if (secondaryType && sectorType === secondaryType) return SECTOR_TYPE_SECONDARY_MATCH_BONUS;
  return SECTOR_TYPE_MISMATCH_PENALTY;
}

/** Preserve the payroll basis from before the operating specialization buff. */
export function specializationPayrollModifier(
  sectorType: string,
  corporationType: string,
  secondaryType?: string | null
): number {
  if (sectorType === corporationType) return 5;
  if (secondaryType && sectorType === secondaryType) return 2.5;
  return SECTOR_TYPE_MISMATCH_PENALTY;
}

export function specializationMaintenance(input: {
  revenue: number;
  operatingMargin: number;
  payrollMargin: number;
}): { payrollBasis: number; operatingSaving: number } {
  const payrollBasis = input.revenue * (1 - input.payrollMargin / 100);
  const operatingBasis = input.revenue * (1 - input.operatingMargin / 100);
  return { payrollBasis, operatingSaving: payrollBasis - operatingBasis };
}
