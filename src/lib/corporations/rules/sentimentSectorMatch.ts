/** Match country-wide sector pulses against legacy and model-qualified operating markets. */
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";

export function hasOperatingSentimentSector(
  operatingSectorKeys: ReadonlySet<string>,
  countryId: string,
  sectorType: string
): boolean {
  if (operatingSectorKeys.has(`${countryId}:${sectorType}`)) return true;
  for (const key of operatingSectorKeys) {
    const parts = key.split(":");
    if (parts.length !== 3 || parts[0] !== countryId || !parts[1]) continue;
    if (
      parts[1] === sectorType ||
      getOperatingSectorType(parts[1], parts[2] || null) === sectorType
    ) {
      return true;
    }
  }
  return false;
}
