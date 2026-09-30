import type { LivingConflictDef } from "../types";
type ConflictParticipants = LivingConflictDef["participants"];

export interface FinancialCountryExposure {
  countryId: string;
  euroMember: boolean;
  bankStress: number;
  sovereignStress: number;
  euroSovereignExposure: number;
  exposedBankAssets: number;
  treasuryBalance: number;
}

/** Actual charter distress determines responders; geography cannot confer exposure. */
export function financialCrisisParticipants(
  rows: FinancialCountryExposure[]
): ConflictParticipants {
  const ranked = [...rows].sort(
    (a, b) => b.bankStress - a.bankStress || a.countryId.localeCompare(b.countryId)
  );
  const belligerents = ranked
    .filter((row) => row.bankStress > 0)
    .slice(0, 2)
    .map((row) => row.countryId);
  const used = new Set(belligerents);
  const creditor = ranked
    .filter(
      (row) =>
        !used.has(row.countryId) &&
        row.euroMember &&
        row.euroSovereignExposure > 0 &&
        row.treasuryBalance > 0
    )
    .sort((a, b) => b.euroSovereignExposure - a.euroSovereignExposure)[0];
  if (creditor) used.add(creditor.countryId);
  const neighbors = ranked
    .filter(
      (row) =>
        !used.has(row.countryId) &&
        row.euroMember &&
        (row.sovereignStress > 0 || row.euroSovereignExposure > 0)
    )
    .map((row) => row.countryId);
  neighbors.forEach((id) => used.add(id));
  const blocMembers = ranked
    .filter((row) => !used.has(row.countryId) && row.bankStress > 0)
    .map((row) => row.countryId);
  blocMembers.forEach((id) => used.add(id));
  return {
    belligerents,
    backerA: creditor?.countryId,
    neighbors,
    blocMembers,
    bystanders: ranked.filter((row) => !used.has(row.countryId)).map((row) => row.countryId),
  };
}

/** A live, bounded observation, not an accumulating narrative-pressure score. */
export function euroFeedbackExposure(rows: FinancialCountryExposure[]): number {
  const exposure = rows.reduce((sum, row) => sum + row.euroSovereignExposure, 0);
  const assets = rows.reduce((sum, row) => sum + row.exposedBankAssets, 0);
  return assets > 0 ? Math.min(100, Math.max(0, (100 * exposure) / assets)) : 0;
}
