import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * Ireland planning region demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the IE voter group IDs from ieDemographicCategories.ts.
 *
 * The category key is "ie_voterGroups" to align with the IE demographic
 * profile and avoid collision with US/UK/DE/JP documents in the same
 * stateDemographicTurnout collection.
 *
 * One document per planning region (matches ieRegions.ts IDs).
 */

const IE_REGION_IDS = ["DUB", "KIL", "MID", "LIM", "COR", "WEX", "GAL", "DON"];

const ZERO_MODIFIERS = {
  urban_professional: 0,
  rural_traditional: 0,
  working_class: 0,
  new_irish: 0,
  small_business: 0,
  retirees: 0,
  young_urban: 0,
  border_communities: 0,
};

export const ieDemographicTurnout: StateDemographicTurnout[] = IE_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "IE" as const,
  modifiers: {
    ie_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default ieDemographicTurnout;
