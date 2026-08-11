/**
 * Per-region, per-cohort referendum affinity: a RELATIVE Yes-lean offset
 * (−50..+50) layered on the region's independence/reunification desire, then
 * re-centered to that desire at campaign open (see cohortEngine). Groups with
 * no entry default to 0 (neutral).
 *
 * Keys are the real `uk_voterGroups` archetype ids (see
 * src/lib/seeds/uk/ukDemographicCategories.ts) — the same 12 groups appear in
 * every UK region's `stateDemographics.groups`, with region-specific
 * populations. "Yes" = leaving the UK (independence / reunification): cultural
 * progressives and younger renters skew Yes; rural traditionalists, retirees,
 * and the populist right skew toward the union.
 */
const LEAVE_UK_AFFINITY: Record<string, number> = {
  urban_progressives: 25,
  young_renters: 20,
  green_activists: 22,
  public_sector: 12,
  post_industrial_workers: 8,
  new_britons: 5,
  moderate_centrists: 0,
  small_business: -10,
  suburban_homeowners: -12,
  populist_right: -15,
  retirees: -22,
  rural_traditionalists: -25,
};

export const REFERENDUM_COHORT_AFFINITY: Record<string, Record<string, number>> = {
  SCO: LEAVE_UK_AFFINITY,
  WAL: LEAVE_UK_AFFINITY,
  NIR: LEAVE_UK_AFFINITY,
};

export function cohortAffinitiesFor(regionId: string): Record<string, number> {
  return REFERENDUM_COHORT_AFFINITY[regionId.toUpperCase()] ?? {};
}
