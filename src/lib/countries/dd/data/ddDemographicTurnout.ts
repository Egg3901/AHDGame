import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * East Germany Land demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the DD voter group IDs from
 * ddDemographicCategories.ts (category _id "dd_voterGroups", profile
 * "dd_archetypes").
 *
 * One document per Land. `_id` is the region code (BEO/MV/BB/ST/SN/TH) —
 * the same globally-unique key `buildRegionTurnoutResponse` reads. In
 * divided-Germany eras those codes belong to DD, not DE.
 */

const DD_REGION_IDS = ["BEO", "MV", "BB", "ST", "SN", "TH"] as const;

const ZERO_MODIFIERS = {
  party_nomenklatura: 0,
  industrial_worker: 0,
  collective_farmer: 0,
  intelligentsia: 0,
  christian_milieu: 0,
  youth: 0,
};

export const ddDemographicTurnout: StateDemographicTurnout[] = DD_REGION_IDS.map((regionId) => ({
  _id: regionId,
  countryId: "DD" as const,
  modifiers: {
    dd_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default ddDemographicTurnout;
