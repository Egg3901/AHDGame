import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * Japan region demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV or canvassing boosts applied yet.
 * Keys match the JP voter group IDs defined in jpDemographicCategories.ts.
 *
 * The category key is "jp_voterGroups" to match the JP demographic profile
 * and to avoid collision with US/UK documents in the same collection.
 *
 * One document per JP region (matches jpRegions.ts IDs).
 */

const JP_REGION_IDS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];

const ZERO_MODIFIERS = {
  salaryman_conservative: 0,
  urban_progressive: 0,
  rural_traditionalist: 0,
  young_urban: 0,
  retiree: 0,
  public_sector: 0,
  small_business: 0,
  komeito_faithful: 0,
  reform_populist: 0,
  working_mothers: 0,
};

export const jpDemographicTurnout: StateDemographicTurnout[] = JP_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "JP" as const,
  modifiers: {
    jp_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default jpDemographicTurnout;
