/**
 * The 1991 game's six Hungarian macroregions are a coarser map than the 2014
 * statutory county map. These fixed district counts preserve all 106 mandates
 * and keep filing IDs stable as simulated population changes.
 */
export const HU_DISTRICTS_BY_REGION = {
  HU_BUD: 21,
  HU_PES: 10,
  HU_TRW: 22,
  HU_TRS: 10,
  HU_NOR: 13,
  HU_ALF: 30,
} as const;

export function huDistrictIds(regionId: string): string[] {
  const count = HU_DISTRICTS_BY_REGION[regionId as keyof typeof HU_DISTRICTS_BY_REGION];
  if (!count) return [];
  return Array.from({ length: count }, (_, index) => `${regionId}:${index + 1}`);
}

export function isHuDistrictInRegion(districtId: string, regionId: string): boolean {
  return huDistrictIds(regionId).includes(districtId);
}
