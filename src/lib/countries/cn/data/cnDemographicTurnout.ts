import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * China macro-region demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the CN voter group IDs from cnDemographicCategories.ts.
 *
 * The category key is "cn_voterGroups" to align with the CN demographic
 * profile and avoid collision with US/UK/DE/JP documents in the same
 * stateDemographicTurnout collection.
 *
 * One document per macro-region (matches cnRegions.ts IDs).
 */

const CN_REGION_IDS = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];

const ZERO_MODIFIERS = {
  party_cadre: 0,
  urban_professional: 0,
  rural_peasant: 0,
  industrial_worker: 0,
  migrant_worker: 0,
  entrepreneur: 0,
  youth: 0,
};

export const cnDemographicTurnout: StateDemographicTurnout[] = CN_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "CN" as const,
  modifiers: {
    cn_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default cnDemographicTurnout;
