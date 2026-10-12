import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
/** Runtime territory departures shrink the Commons while tolerating its known seed discrepancy. */
export function liveSingleTierChamber(countryId: string, sum: number, base: number): number {
  if (countryId === COUNTRY_CONFIGS.UK.id && sum > 0 && sum < base - 2) return sum;
  return Math.max(sum, base);
}
