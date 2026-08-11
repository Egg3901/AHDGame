import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * Brazil macro-region demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the BR voter group IDs from brDemographicCategories.ts.
 *
 * The category key is "br_voterGroups" to align with the BR demographic
 * profile and avoid collision with DE/US/UK/JP documents in the same
 * stateDemographicTurnout collection.
 *
 * One document per macro-region (matches brRegions.ts IDs).
 */

const BR_REGION_IDS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];

const ZERO_MODIFIERS = {
  evangelical_conservative: 0,
  working_class_pt: 0,
  rural_agribusiness: 0,
  urban_middle_class: 0,
  urban_poor: 0,
  afro_brazilian: 0,
  business_financial: 0,
  young_progressive: 0,
};

export const brDemographicTurnout: StateDemographicTurnout[] = BR_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "BR" as const,
  modifiers: {
    br_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default brDemographicTurnout;
