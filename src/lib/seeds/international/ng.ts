/**
 * Nigeria Layer-1 demographic model — census-consuming build.
 *
 * Architecture:
 *   - dims: ["religion","ethnicity","age","education","income","urbanization"]
 *   - census: approximate per-zone NPC/NBS data from ngRegionCensusData.ts
 *   - composition: maps each of the 8 NG archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented Nigerian political history
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * SCAFFOLD NOTE: Only the "2019" era positions are authored; other eras reuse
 * POSITIONS_2019. Census files exist for 1953 and 1979
 * (`ngRegionCensusData1953` / `ngRegionCensusData1979`, wired in
 * `regionCensusData.ts`), but this model still points every era at the 2019
 * table. Era-specific positions (Second Republic 1979, early Fourth Republic
 * 1999, Yar'Adua/Jonathan 2007, Tinubu 2023) are still unauthored.
 *
 * Era-fact anchors to validate in ng.test.ts once era-specific positions land:
 *   2019: NORTH-WEST + NORTH-EAST economically RIGHT (Buhari APC base);
 *         SOUTH-SOUTH economically LEFT (PDP/Jonathan resource-control base)
 *   2023: SOUTH-WEST competitive (Tinubu home turf); SOUTH-EAST LEFT (LP/Obi)
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { ngRegionCensusData } from "@/lib/seeds/ng/ngRegionCensusData";
import type { NGRegionLayer1 } from "@/lib/seeds/ng/ngRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const NG_GROUP_IDS = [
  "northern_muslim_conservative",
  "yoruba_moderate",
  "igbo_business",
  "niger_delta_youth",
  "christian_conservative",
  "urban_young_progressive",
  "rural_agrarian",
  "lagos_cosmopolitan",
] as const;

type GroupId = (typeof NG_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Nigeria has NO compulsory voting (unlike Brazil). INEC averages: ~35% in 2019,
// ~27% in 2023 (lowest turnout in recent African democracies). Turnout is
// highly uneven: the North-West has strong APC mobilisation networks but also
// low female participation in some states; the South-East has the highest
// educational attainment but historically lower registration trust.
// Rates below are plausible dim/key baselines in the 30-70 range.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  religion: {
    muslim: 45, // Northern APC mobilisation networks; but lower female participation
    christian: 50, // CAN/PFN GOTV networks in Middle Belt and South
    other: 35, // Minority faiths; lower institutional mobilisation
  },
  ethnicity: {
    hausa_fulani: 42, // Mass mobilisation via emirate networks but low education access
    yoruba: 55, // Highest civic engagement in South-West
    igbo: 58, // High political awareness; diaspora linkage
    minority: 45, // South-South minorities; volatile turnout
  },
  age: {
    young: 38, // 18-29: #EndSARS generation; highest abstention
    mid: 50, // 30-44: peak civic engagement
    mature: 55, // 45-64
    senior: 50, // 65+: reliable but smaller cohort
  },
  education: {
    basic: 40, // Lowest registration quality; rural North especially
    secondary: 50,
    tertiary: 60, // Graduates have highest turnout
  },
  income: {
    low: 38, // Transport/work barriers; voter apathy
    middle: 50,
    high: 62, // Lagos/Abuja professional class; high mobilisation
  },
  urbanization: {
    urban: 52, // Lagos, Abuja, Port Harcourt — best INEC access
    suburban: 50,
    rural: 38, // Distance to polling units; northern rural especially low
  },
};

// ── Composition: archetype ← census dims ──────────────────────────────────────
// Weights are era-stable: they capture the defining census signals of each
// attitudinal group, not their vote share (that emerges from positions × census).
//
// Census dims available: religion, ethnicity, age, education, income, urbanization.
// Unlike BR (which proxies religion via urbanization/income), NG has an explicit
// religion dim — so northern_muslim_conservative and christian_conservative can
// weight religion directly.

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Northern Muslim Conservative:
   * Hausa-Fulani caliphate heartland; Muslim, rural, low income, basic education.
   * APC northern base; emirate and CPC/ANPP lineage networks.
   */
  northern_muslim_conservative: {
    weights: [
      { dim: "religion", key: "muslim", w: 0.4 },
      { dim: "ethnicity", key: "hausa_fulani", w: 0.3 },
      { dim: "urbanization", key: "rural", w: 0.2 },
      { dim: "income", key: "low", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },

  /**
   * Yoruba Moderate:
   * South-West Yoruba bloc; ACN/APC lineage but PDP-competitive. Secondary-to-
   * tertiary education, middle income, urban, ethnoregional calculus drives
   * swings.
   */
  yoruba_moderate: {
    weights: [
      { dim: "ethnicity", key: "yoruba", w: 0.45 },
      { dim: "education", key: "secondary", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "income", key: "middle", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },

  /**
   * Igbo Business:
   * South-East Igbo commercial class; trading and entrepreneurship. High income,
   * tertiary education, urban, pro-market.
   */
  igbo_business: {
    weights: [
      { dim: "ethnicity", key: "igbo", w: 0.4 },
      { dim: "income", key: "high", w: 0.25 },
      { dim: "education", key: "tertiary", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
    ],
    civicMultiplier: 1.05, // Commercial-class GOTV networks
  },

  /**
   * Niger Delta Youth:
   * South-South minority nationalities; resource-control politics. Christian,
   * minority ethnicity, young, suburban/urban, low-middle income.
   */
  niger_delta_youth: {
    weights: [
      { dim: "ethnicity", key: "minority", w: 0.35 },
      { dim: "religion", key: "christian", w: 0.2 },
      { dim: "age", key: "young", w: 0.25 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
    ],
    civicMultiplier: 0.9,
  },

  /**
   * Christian Conservative:
   * Middle Belt and southern Christian bloc; CAN/PFN networks. Christian,
   * mature, middle income, secondary education.
   */
  christian_conservative: {
    weights: [
      { dim: "religion", key: "christian", w: 0.45 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "income", key: "middle", w: 0.2 },
      { dim: "education", key: "secondary", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },

  /**
   * Urban Young Progressive:
   * Lagos/Abuja/Port Harcourt university youth; #EndSARS generation. Young,
   * tertiary, urban, middle income.
   */
  urban_young_progressive: {
    weights: [
      { dim: "age", key: "young", w: 0.35 },
      { dim: "education", key: "tertiary", w: 0.25 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "income", key: "middle", w: 0.15 },
    ],
    civicMultiplier: 0.85, // Highest abstention despite strong attitudes
  },

  /**
   * Rural Agrarian:
   * Northern and Middle Belt smallholders; subsistence agriculture. Rural,
   * low income, basic education, mixed age (skews mature).
   */
  rural_agrarian: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.4 },
      { dim: "income", key: "low", w: 0.25 },
      { dim: "education", key: "basic", w: 0.25 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 0.9,
  },

  /**
   * Lagos Cosmopolitan:
   * Lagos Island/Victoria Island/Ikeja GRA professionals; finance, tech, media.
   * Urban, high income, tertiary, mid age.
   */
  lagos_cosmopolitan: {
    weights: [
      { dim: "urbanization", key: "urban", w: 0.35 },
      { dim: "income", key: "high", w: 0.3 },
      { dim: "education", key: "tertiary", w: 0.25 },
      { dim: "age", key: "mid", w: 0.1 },
    ],
    civicMultiplier: 1.05, // Professional-class GOTV; high Lagos turnout
  },
};

// ── Default leans (archetype priors, from ngDemographicCategories.ts) ──────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  northern_muslim_conservative: { economicLean: 2, socialLean: 3 },
  yoruba_moderate: { economicLean: 0, socialLean: 0 },
  igbo_business: { economicLean: 1, socialLean: -1 },
  niger_delta_youth: { economicLean: -2, socialLean: -1 },
  christian_conservative: { economicLean: 1, socialLean: 2 },
  urban_young_progressive: { economicLean: -2, socialLean: -2 },
  rural_agrarian: { economicLean: 1, socialLean: 1 },
  lagos_cosmopolitan: { economicLean: 0, socialLean: -1 },
};

// ── Per-era positions: how each census key leaned in that political era ─────────
//
// Scale: economicLean -5 (redistribution/left) to +5 (free market/right)
//        socialLean   -5 (progressive/liberal) to +5 (traditional/conservative)
//
// SCAFFOLD: only 2019 is authored. Other eras reuse POSITIONS_2019 and the
// 2019-default census (ngRegionCensusData) until era-specific profiles land.
//
// 2019: BUHARI RE-ELECTION (APC).
//   Buhari defeated Atiku (PDP) with ~56% in the 2nd cycle of the Fourth Republic.
//   North-West + North-East = APC Muslim-conservative base (econ right via
//   subsidy politics, social right via religion). South-South = PDP/Jonathan
//   resource-control base (econ left). South-West = APC but competitive
//   (Tinubu machine). South-East = PDP but low turnout. Religion is the primary
//   social cleavage; ethnicity the primary regional differentiator.

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

// ─────────────────────────────────────────────────────────────────────────────
// 2019 — BUHARI SECOND TERM (APC)
// Religion is the dominant social cleavage; ethnicity drives regional
// differentiation; income.high = market right; income.low = transfer-dependent
// econ left; urbanization.rural = socially traditional.
// ─────────────────────────────────────────────────────────────────────────────
const POSITIONS_2019: EraPositions = {
  religion: {
    // Muslim = APC northern base; social right (sharia states, family law).
    // Christian = split (Middle Belt CAN vs South-South PDP); mild social right.
    muslim: { economicLean: 1.0, socialLean: 3.0 },
    christian: { economicLean: 0.5, socialLean: 1.0 },
    other: { economicLean: 0.0, socialLean: 0.0 }, // Small cohort; no clear alignment
  },
  ethnicity: {
    // Hausa-Fulani = APC base; social right via caliphate tradition.
    // Yoruba = centrist; ethnoregional calculus dominates.
    // Igbo = pro-market but PDP/SE zone alignment; mild social liberal.
    // Minority = South-South resource-control; econ left.
    hausa_fulani: { economicLean: 1.5, socialLean: 3.0 },
    yoruba: { economicLean: 0.0, socialLean: 0.0 },
    igbo: { economicLean: 1.0, socialLean: -0.5 },
    minority: { economicLean: -1.0, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -2.0 }, // #EndSARS cohort; progressive
    mid: { economicLean: 0.0, socialLean: 0.0 },
    mature: { economicLean: 0.5, socialLean: 1.0 }, // APC establishment base
    senior: { economicLean: 1.0, socialLean: 1.5 }, // Traditional; caliphate elders
  },
  education: {
    basic: { economicLean: 0.5, socialLean: 1.5 }, // Northern rural; traditional
    secondary: { economicLean: 0.0, socialLean: 0.5 }, // Split
    tertiary: { economicLean: -0.5, socialLean: -1.0 }, // University progressive; some LP/PPM pull
  },
  income: {
    low: { economicLean: -1.5, socialLean: 0.5 }, // Transfer-dependent; econ left
    middle: { economicLean: 0.5, socialLean: 0.0 }, // "Classe média" split
    high: { economicLean: 2.0, socialLean: 0.5 }, // Lagos finance + northern elites
  },
  urbanization: {
    urban: { economicLean: 0.0, socialLean: -1.0 }, // Lagos/Abuja cosmopolitan; socially liberal
    suburban: { economicLean: 0.5, socialLean: 0.0 },
    rural: { economicLean: 1.0, socialLean: 2.0 }, // Northern rural = strongly traditional
  },
};

const ERA_POSITIONS: Record<EraId, EraPositions> = {
  "1953": POSITIONS_2019, // SCAFFOLD: colonial Nigeria — no electoral data; NPP/coming-soon tier
  "1979": POSITIONS_2019, // SCAFFOLD: replace with Second Republic positions
  "1991": POSITIONS_2019, // SCAFFOLD: replace with aborted Third Republic positions
  "1999": POSITIONS_2019, // SCAFFOLD: replace with early Fourth Republic (Obasanjo) positions
  "2007": POSITIONS_2019, // SCAFFOLD: replace with Yar'Adua/Jonathan positions
  "2019": POSITIONS_2019,
  "2023": POSITIONS_2019, // SCAFFOLD: replace with Tinubu / LP-Obi realignment positions
};

// ── Census conversion ──────────────────────────────────────────────────────────
// NGRegionLayer1 → Record<dim, Record<key, number>>

function convertCensus(
  raw: Record<string, NGRegionLayer1>
): Record<string, Record<string, Record<string, number>>> {
  return Object.fromEntries(
    Object.entries(raw).map(([regionId, layer1]) => [
      regionId,
      {
        religion: layer1.religion as unknown as Record<string, number>,
        ethnicity: layer1.ethnicity as unknown as Record<string, number>,
        age: layer1.age as unknown as Record<string, number>,
        education: layer1.education as unknown as Record<string, number>,
        income: layer1.income as unknown as Record<string, number>,
        urbanization: layer1.urbanization as unknown as Record<string, number>,
      },
    ])
  );
}

const ERA_CENSUS: Record<EraId, Record<string, NGRegionLayer1>> = {
  "1953": ngRegionCensusData, // SCAFFOLD: colonial Nigeria; replace with 1953-era census when authored
  "1979": ngRegionCensusData, // SCAFFOLD: replace with 1979-era census when authored
  "1991": ngRegionCensusData, // SCAFFOLD: replace with 1991-era census when authored
  "1999": ngRegionCensusData, // SCAFFOLD: replace with 1999-era census when authored
  "2007": ngRegionCensusData, // SCAFFOLD: replace with 2007-era census when authored
  "2019": ngRegionCensusData, // 2019 base (NPC/NBS estimates)
  "2023": ngRegionCensusData, // SCAFFOLD: replace with 2023-era census when authored
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getNgModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "NG",
    categoryId: "ng_voterGroups",
    groupIds: [...NG_GROUP_IDS],
    dims: ["religion", "ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ──────────────────────────

export const ngLayer1Model: CountryLayer1Model = getNgModel("2019");
export const ngGroupIds = [...NG_GROUP_IDS];
