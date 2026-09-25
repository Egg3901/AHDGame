/** Plain-data seed rule: choose the authored spending envelope when the
 * available law catalog belongs to a different institutional era. */
export const TRANSITION_1991_BUDGET_COUNTRIES = ["RU", "PL", "CS", "HU", "RO", "BG", "YU"];

export function shouldUseFullAuthoredBudgetBaseline(input: {
  countryId: string;
  fiscalYear: number;
  politicalLegislationCountry: boolean;
}): boolean {
  const { countryId, fiscalYear, politicalLegislationCountry } = input;
  if (fiscalYear === 1953 && politicalLegislationCountry) return true;
  if (fiscalYear === 1991) {
    return TRANSITION_1991_BUDGET_COUNTRIES.includes(countryId);
  }
  // HU's 2027 fiscal totals use the latest completed KSH year while its
  // existing legislation catalog still describes the 1979 one-party economy.
  // The authored modern envelope must win until modern laws are seeded.
  return fiscalYear === 2027 && countryId === "HU";
}
