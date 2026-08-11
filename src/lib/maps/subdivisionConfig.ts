// src/lib/maps/subdivisionConfig.ts
// Registry of which (country, electionType) pairs have sub-region map data.
// Adding a country = add an entry here + a build script + committed JSON.

export type SubdivisionMode = "distributed" | "seatConsistent" | "seatOrdered";

export interface SubdivisionModeConfig {
  electionTypes: string[];
  /** Directory under src/data/ holding per-region JSON files. */
  dataDir: string;
  /** Singular/plural display nouns for the generic UI ("Constituency Results",
   *  "Districts" count row). US paths keep their hardcoded copy. */
  unitLabel?: string;
  unitLabelPlural?: string;
}

const REGISTRY: Record<string, Partial<Record<SubdivisionMode, SubdivisionModeConfig>>> = {
  UK: {
    seatConsistent: {
      electionTypes: ["commons", "snap_commons", "regionalCouncil"],
      dataDir: "subdivisions/uk",
      unitLabel: "Constituency",
      unitLabelPlural: "Constituencies",
    },
  },
  RU: {
    seatConsistent: {
      // Types from the USSR political-wiring spec (§1.3/§1.4). RU is
      // coming-soon; maps ship latent and light up when tallies exist.
      electionTypes: ["supremeSovietDeputy", "nationalitiesDeputy", "republicSupremeSoviet"],
      dataDir: "subdivisions/ru",
      unitLabel: "District",
      unitLabelPlural: "Districts",
    },
  },
  US: {
    distributed: {
      // stateSenate included: the election-detail compact map renders county
      // results for state-senate races (legacy county-results route served any
      // US election type; these four are the ones with UI consumers).
      electionTypes: ["president", "governor", "senate", "stateSenate"],
      dataDir: "counties",
    },
    seatOrdered: {
      electionTypes: ["house"],
      dataDir: "congressional-districts",
    },
  },
};

export function getSubdivisionMode(
  countryId: string,
  electionType: string
): { mode: SubdivisionMode; config: SubdivisionModeConfig } | null {
  const country = REGISTRY[countryId];
  if (!country) return null;
  for (const [mode, config] of Object.entries(country) as [
    SubdivisionMode,
    SubdivisionModeConfig,
  ][]) {
    if (config.electionTypes.includes(electionType)) return { mode, config };
  }
  return null;
}
