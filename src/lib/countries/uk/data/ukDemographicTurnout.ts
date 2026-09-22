import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * UK region demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV or canvassing boosts applied yet.
 * Keys match the UK voter group IDs defined in ukDemographicCategories.ts.
 *
 * The category key is "uk_voterGroups" to match the UK demographic profile ID
 * and to avoid collision with US "voterGroups" category.
 *
 * One document per UK region (matches ukRegions.ts IDs).
 * The dynamic DemographicModifiers type (Record<string, Record<string, number>>)
 * allows this to coexist with US documents in the same collection.
 */

const UK_REGION_IDS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];

const ZERO_MODIFIERS = {
  post_industrial_workers: 0,
  urban_progressives: 0,
  suburban_homeowners: 0,
  young_renters: 0,
  rural_traditionalists: 0,
  retirees: 0,
  public_sector: 0,
  moderate_centrists: 0,
  populist_right: 0,
  green_activists: 0,
  small_business: 0,
  new_britons: 0,
};

export const ukDemographicTurnout: StateDemographicTurnout[] = UK_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "UK" as const,
  modifiers: {
    uk_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default ukDemographicTurnout;
