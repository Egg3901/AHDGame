import type { StateDemographicTurnout } from "@/lib/db/types";

/**
 * Germany Bundesländer demographic turnout modifier seeds.
 *
 * All modifiers start at 0 — no GOTV, canvassing, or suppression effects
 * applied yet. Keys match the DE voter group IDs from deDemographicCategories.ts.
 *
 * The category key is "de_voterGroups" to align with the DE demographic
 * profile and avoid collision with US/UK/JP documents in the same
 * stateDemographicTurnout collection.
 *
 * One document per Bundesland (matches deRegions.ts IDs).
 */

const DE_LAND_IDS = [
  "BW",
  "BY",
  "BE",
  "BB",
  "BRE",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
];

const ZERO_MODIFIERS = {
  katholische_konservative: 0,
  gewerkschafter: 0,
  urbane_progressive: 0,
  wirtschaftsliberale: 0,
  ost_post_industriell: 0,
  gruene_mittelschicht: 0,
  rentner_west: 0,
  migranten_communities: 0,
  landwirte_dorf: 0,
  junge_grossstadt: 0,
  protest_waehler_ost: 0,
  mittelstand_selbstaendige: 0,
};

export const deDemographicTurnout: StateDemographicTurnout[] = DE_LAND_IDS.map((landId) => ({
  _id: landId,
  countryId: "DE" as const,
  modifiers: {
    de_voterGroups: { ...ZERO_MODIFIERS },
  },
  lastDecayApplied: new Date(),
  lastUpdated: new Date(),
}));

export default deDemographicTurnout;
