/** Successor regions keep the calibration of the territory they inherited. */
export function inheritedCalibrationRegion(
  countryId: string,
  regionId: string
): { countryId: string; regionId: string } {
  if (countryId === "SCO" || countryId === "WAL") return { countryId: "UK", regionId: countryId };
  if (countryId === "IE" && regionId === "NIR") return { countryId: "UK", regionId: "NIR" };
  return { countryId, regionId };
}
export function inheritedCalibrationCountry(countryId: string): string {
  return countryId === "SCO" || countryId === "WAL" ? "UK" : countryId;
}
