import type { StateDemographics, StateDemographicGroup } from "@/lib/db/types";
import type { DemographicModifiers } from "@/lib/db/types/stateDemographicTurnout";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEMOGRAPHIC_TURNOUT_RATES,
  DEMOGRAPHIC_LABELS,
  getEraComposition,
} from "./demographicCategories";
import type { EraId } from "./presetSelector";
import { stateCensusData as importedCensusData } from "./stateCensusData";

import type { Layer1Config, Layer1SeedOverride } from "./stateDemographicsPure";
import {
  deriveGroupPopulations,
  deriveGroupLean,
  deriveGroupLeanFromLayer1,
  deriveGroupTurnout,
} from "./stateDemographicsPure";
export type { Layer1Config, Layer1SeedOverride } from "./stateDemographicsPure";
export {
  deriveGroupPopulations,
  deriveGroupLeanFromLayer1,
  deriveGroupTurnout,
} from "./stateDemographicsPure";

/**
 * Return live-computed turnout rates for all 12 voter groups in a state.
 * Uses the in-memory stateCensusData (populated at module init) so the result
 * is always up-to-date with the current deriveGroupTurnout logic — no DB reseed required.
 * Now fetches state-specific demographic turnout modifiers and applies them to Layer 1 baseline rates.
 * Returns null if the state has no Layer-1 config registered.
 */
export async function computeLiveGroupTurnouts(
  stateId: string,
  era: EraId = "2019"
): Promise<Record<string, number> | null> {
  const config = stateCensusDataByEra[era][stateId];
  if (!config) return null;

  const comp = getEraComposition(era);

  // Fetch state-specific turnout modifiers
  let stateSpecificTurnout:
    | {
        race: Record<string, number>;
        age: Record<string, number>;
        education: Record<string, number>;
        wealth: Record<string, number>;
        ideology: Record<string, number>;
      }
    | undefined;

  try {
    const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
    const turnoutCollection = await getStateDemographicTurnoutCollection();
    const turnoutModifiers = await turnoutCollection.findOne({ _id: stateId });

    if (turnoutModifiers) {
      // Calculate actual Layer 1 turnout rates (baseline + modifiers)
      stateSpecificTurnout = {
        race: {},
        age: {},
        education: {},
        wealth: {},
        ideology: {},
      };

      for (const category of ["race", "age", "education", "wealth", "ideology"] as const) {
        for (const group in turnoutModifiers.modifiers[category]) {
          const categoryKey = category as keyof typeof DEMOGRAPHIC_TURNOUT_RATES;
          const groupKey = group as keyof (typeof DEMOGRAPHIC_TURNOUT_RATES)[typeof categoryKey];
          const baseline = comp.turnoutRates[categoryKey][groupKey] ?? 55;
          const modifier =
            turnoutModifiers.modifiers[category][
              group as keyof (typeof turnoutModifiers.modifiers)[typeof category]
            ];
          stateSpecificTurnout[category][group] = baseline + modifier;
        }
      }
    }
  } catch (error) {
    console.warn(
      `[computeLiveGroupTurnouts] Could not fetch turnout modifiers for ${stateId}:`,
      error
    );
    // Fall back to baseline turnout rates
  }

  const result: Record<string, number> = {};
  for (const id of comp.groupIds) {
    const baseTurnout = comp.defaultTurnouts[id] ?? 55;
    result[id] = deriveGroupTurnout(id, config, baseTurnout, era, stateSpecificTurnout);
  }
  return result;
}

function generateStateDemographics(
  stateId: string,
  config: Layer1Config,
  era: EraId,
  countryId: CountryId = "US",
  opts: {
    layer1Positions?: boolean;
    positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
    turnout?: Layer1SeedOverride["turnout"];
    composition?: Layer1SeedOverride["composition"];
  } = {}
): StateDemographics {
  // Turnout/composition overrides are authored alongside positions and only
  // applied when the Layer-1 path is on (the legacy path is left untouched).
  const override: Layer1SeedOverride | undefined = opts.layer1Positions
    ? { positions: opts.positions, turnout: opts.turnout, composition: opts.composition }
    : undefined;
  const comp = getEraComposition(era);
  const populations = deriveGroupPopulations(config, era, override);
  const groups: Record<string, StateDemographicGroup> = {};

  for (const id of comp.groupIds) {
    const baseTurnout = comp.defaultTurnouts[id] ?? 55;
    const derivedTurnout = deriveGroupTurnout(id, config, baseTurnout, era, undefined, override);
    const lean = opts.layer1Positions
      ? // stateId threads through so per-state era position overrides
        // (STATE_POSITION_OVERRIDES, e.g. 1953 Solid-South whites) apply.
        deriveGroupLeanFromLayer1(id, config, era, opts.positions, override, stateId)
      : deriveGroupLean(id, config, era);
    groups[id] = {
      population: Math.round(populations[id] * 100) / 100,
      ...lean,
      turnout: derivedTurnout, // always store derived turnout from underlying Layer 1
    };
  }

  return {
    _id: stateId,
    countryId,
    categoryWeights: { voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };
}

/**
 * Era-keyed in-memory Layer-1 census configs, populated by registerAndGenerate.
 * Each era's seed lane registers its own bundle; 2019 is populated at module init.
 */
export const stateCensusDataByEra: Record<EraId, Record<string, Layer1Config>> = {
  "1953": {},
  "1979": {},
  "1991": {},
  "1999": {},
  "2007": {},
  "2019": {},
  "2023": {},
};

// Re-export the 2019 source data for backward compatibility
export { stateCensusData } from "./stateCensusData";

/** Entries for one demographic dimension, for display in the poll UI */
export interface DemographicTurnoutEntry {
  key: string;
  label: string;
  statePct: number; // % of state population (from Layer-1)
  turnoutRate: number; // national baseline turnout rate (%)
  turnoutPop: number; // estimated voters = statePop × statePct × turnoutRate
}

export interface StateDemographicTurnout {
  race: DemographicTurnoutEntry[];
  age: DemographicTurnoutEntry[];
  education: DemographicTurnoutEntry[];
  wealth: DemographicTurnoutEntry[];
}

/**
 * Compute demographic-level turnout data for display in the poll UI.
 * Combines state Layer-1 population % with the effective turnout rate per group
 * (national baseline + any per-dimension modifier stored on the
 * stateDemographicTurnout doc — same combination the state Demographics &
 * Turnout "Combined" view and the election engine's resolveTurnout use, so
 * the poll's panel doesn't drift from those after GOTV / canvassing / decay).
 * Call after module initialization (stateCensusData is populated by registerAndGenerate).
 */
export function computeStateDemographicTurnout(
  stateId: string,
  statePopulation: number,
  era: EraId = "2019",
  turnoutModifiers?: DemographicModifiers | null
): StateDemographicTurnout | null {
  const config = stateCensusDataByEra[era][stateId];
  if (!config) return null;

  const comp = getEraComposition(era);

  function buildEntries(
    dim: keyof typeof DEMOGRAPHIC_TURNOUT_RATES,
    pctMap: Record<string, number>
  ): DemographicTurnoutEntry[] {
    const rates = comp.turnoutRates[dim] as Record<string, number>;
    const labels = DEMOGRAPHIC_LABELS[dim] ?? {};
    const dimModifiers = turnoutModifiers?.[dim] ?? {};
    return Object.entries(pctMap).map(([key, statePct]) => {
      const baseline = rates[key] ?? 55;
      const modifier = dimModifiers[key] ?? 0;
      const turnoutRate = Math.max(0, Math.min(100, baseline + modifier));
      const turnoutPop = Math.round(statePopulation * (statePct / 100) * (turnoutRate / 100));
      return { key, label: labels[key] ?? key, statePct, turnoutRate, turnoutPop };
    });
  }

  return {
    race: buildEntries("race", config.race),
    age: buildEntries("age", config.age),
    education: buildEntries("education", config.education),
    wealth: buildEntries("wealth", config.wealth),
  };
}

export function registerAndGenerate(
  stateId: string,
  config: Layer1Config,
  era: EraId = "2019",
  opts: {
    layer1Positions?: boolean;
    positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
    turnout?: Layer1SeedOverride["turnout"];
    composition?: Layer1SeedOverride["composition"];
  } = {}
): StateDemographics {
  stateCensusDataByEra[era][stateId] = config;
  return generateStateDemographics(stateId, config, era, "US", opts);
}

/** Test seam — exposes the gated generation without going through DB. */
export function generateStateDemographicsForTest(
  stateId: string,
  config: Layer1Config,
  era: EraId,
  opts: {
    layer1Positions?: boolean;
    positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
    turnout?: Layer1SeedOverride["turnout"];
    composition?: Layer1SeedOverride["composition"];
  }
): StateDemographics {
  return generateStateDemographics(stateId, config, era, "US", opts);
}

// Populate in-memory map for computeLiveGroupTurnouts / computeStateDemographicTurnout
for (const [stateId, config] of Object.entries(importedCensusData)) {
  stateCensusDataByEra["2019"][stateId] = config;
}

// Generate demographics from imported data
export const stateDemographics: StateDemographics[] = Object.entries(importedCensusData).map(
  ([stateId, config]) => registerAndGenerate(stateId, config, "2019")
);

export default stateDemographics;
