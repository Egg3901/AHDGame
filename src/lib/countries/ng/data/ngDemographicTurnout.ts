import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * Nigeria geo-political zone demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the NG voter group IDs from ngDemographicCategories.ts.
 *
 * The category key is "ng_voterGroups" to align with the NG demographic
 * profile and avoid collision with BR/DE/US/UK/JP/CN documents in the same
 * stateDemographicTurnout collection.
 *
 * One document per geo-political zone (matches ngRegions.ts IDs).
 */

const NG_REGION_IDS = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];

const ZERO_MODIFIERS = {
  northern_muslim_conservative: 0,
  yoruba_moderate: 0,
  igbo_business: 0,
  niger_delta_youth: 0,
  christian_conservative: 0,
  urban_young_progressive: 0,
  rural_agrarian: 0,
  lagos_cosmopolitan: 0,
};

export const ngDemographicTurnout: StateDemographicTurnout[] = NG_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "NG" as const,
  modifiers: {
    ng_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default ngDemographicTurnout;
