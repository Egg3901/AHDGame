/**
 * UK Layer-1 demographic model — census-consuming rebuild.
 *
 * Architecture:
 *   - dims: ["ethnicity","age","education","income","urbanization"]
 *   - census: real per-region ONS data from ukRegionCensusData*.ts
 *   - composition: maps each of the 12 UK archetypes to census dim/key weights
 *   - positions: per-era, reflecting documented UK political history
 *     (Thatcher 1979, Recession 1991, New Labour 1999, Blair peak 2007,
 *      Brexit realignment 2019, post-Truss 2023)
 *   - region/archetype leans EMERGE from census × positions — never hand-calibrated
 *
 * Era-fact anchors validated in uk.test.ts:
 *   1979: SCO, WAL, NEE, NWE, YHU, WMI economically LEFT; SEE, SWE RIGHT
 *   2019: LON strongly LEFT (cosmopolitan); SEE RIGHT; NEE drifting right vs 1979
 */

import type { CountryLayer1Model, DemographicPosition } from "./types";
import { ukRegionCensusData } from "@/lib/seeds/uk/ukRegionCensusData";
import { ukRegionCensusData1953 } from "@/lib/seeds/uk/ukRegionCensusData1953";
import { ukRegionCensusData1979 } from "@/lib/seeds/uk/ukRegionCensusData1979";
import { ukRegionCensusData1991 } from "@/lib/seeds/uk/ukRegionCensusData1991";
import { ukRegionCensusData1999 } from "@/lib/seeds/uk/ukRegionCensusData1999";
import { ukRegionCensusData2007 } from "@/lib/seeds/uk/ukRegionCensusData2007";
import { ukRegionCensusData2023 } from "@/lib/seeds/uk/ukRegionCensusData2023";
import type { UKRegionLayer1 } from "@/lib/seeds/uk/ukRegionCensusData";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Constants ─────────────────────────────────────────────────────────────────

export const UK_GROUP_IDS = [
  "post_industrial_workers",
  "urban_progressives",
  "suburban_homeowners",
  "young_renters",
  "rural_traditionalists",
  "retirees",
  "public_sector",
  "moderate_centrists",
  "populist_right",
  "green_activists",
  "small_business",
  "new_britons",
] as const;

type GroupId = (typeof UK_GROUP_IDS)[number];

// ── Turnout rates (per census dim/key) ────────────────────────────────────────
// Derived from British Election Study data and ONS; era-stable enough for one table.

const TURNOUT_RATES: CountryLayer1Model["turnoutRates"] = {
  ethnicity: {
    white_british: 68,
    asian_british: 52,
    black_british: 48,
    mixed: 50,
    other: 46,
  },
  age: {
    young: 47, // 18-29: consistently lowest turnout (BES 2019: ~47%)
    mid: 62, // 30-44
    mature: 72, // 45-64
    senior: 77, // 65+: highest turnout group
  },
  education: {
    no_qualifications: 52,
    gcse_equivalent: 59,
    a_level_equivalent: 65,
    degree_plus: 74,
  },
  income: {
    low: 52,
    middle: 67,
    high: 74,
  },
  urbanization: {
    urban: 61,
    suburban: 67,
    rural: 70,
  },
};

// ── Composition: archetype ← census dims ─────────────────────────────────────
// Weights reflect the census signals that define each archetype.
// Era-stable: the defining demographics of each archetype don't shift, only their
// political positions shift over time (captured in per-era POSITIONS tables).

const COMPOSITION: Record<GroupId, CountryLayer1Model["composition"][string]> = {
  /**
   * Post-Industrial Workers: left-behind manufacturing communities.
   * Low education, low income, older, urban (industrial towns, not cities).
   */
  post_industrial_workers: {
    weights: [
      { dim: "education", key: "no_qualifications", w: 0.35 },
      { dim: "income", key: "low", w: 0.3 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "urbanization", key: "urban", w: 0.15 },
    ],
    civicMultiplier: 0.9,
  },
  /**
   * Urban Progressives: degree-educated cosmopolitan city dwellers.
   * High education, non-white ethnicity present, young/mid, high urban.
   */
  urban_progressives: {
    weights: [
      { dim: "education", key: "degree_plus", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.25 },
      { dim: "age", key: "young", w: 0.2 },
      { dim: "ethnicity", key: "asian_british", w: 0.08 },
      { dim: "ethnicity", key: "black_british", w: 0.07 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Suburban Homeowners: aspirational property-owning middle class.
   * High income, suburban, mature age, educated to A-level.
   */
  suburban_homeowners: {
    weights: [
      { dim: "urbanization", key: "suburban", w: 0.35 },
      { dim: "income", key: "high", w: 0.3 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "education", key: "a_level_equivalent", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Young Renters: under-35 urban renters, priced out of housing.
   * Young, urban, low income, degree-educated (student debt generation).
   */
  young_renters: {
    weights: [
      { dim: "age", key: "young", w: 0.4 },
      { dim: "urbanization", key: "urban", w: 0.3 },
      { dim: "income", key: "low", w: 0.2 },
      { dim: "education", key: "degree_plus", w: 0.1 },
    ],
    civicMultiplier: 0.82,
  },
  /**
   * Rural Traditionalists: farming communities and market towns.
   * Rural, senior, white British, low-education (apprenticeship, not academic).
   */
  rural_traditionalists: {
    weights: [
      { dim: "urbanization", key: "rural", w: 0.45 },
      { dim: "age", key: "senior", w: 0.25 },
      { dim: "ethnicity", key: "white_british", w: 0.2 },
      { dim: "education", key: "no_qualifications", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Retirees: 65+ across all regions. NHS, pension triple-lock voters.
   */
  retirees: {
    weights: [
      { dim: "age", key: "senior", w: 0.6 },
      { dim: "income", key: "middle", w: 0.25 },
      { dim: "urbanization", key: "suburban", w: 0.15 },
    ],
    civicMultiplier: 1.05,
  },
  /**
   * Public Sector & NHS: teachers, nurses, civil servants.
   * Degree-plus (professional training), middle income, urban, mixed age.
   */
  public_sector: {
    weights: [
      { dim: "education", key: "degree_plus", w: 0.35 },
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Moderate Centrists: educated, fiscally moderate, socially liberal swing voters.
   * A-level educated, middle income, suburban, mid age.
   */
  moderate_centrists: {
    weights: [
      { dim: "education", key: "a_level_equivalent", w: 0.35 },
      { dim: "income", key: "middle", w: 0.3 },
      { dim: "urbanization", key: "suburban", w: 0.2 },
      { dim: "age", key: "mid", w: 0.15 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * Populist Right: anti-establishment, sovereignty-focused, Leave voters.
   * Low education, suburban/rural, mature, white British.
   */
  populist_right: {
    weights: [
      { dim: "education", key: "no_qualifications", w: 0.35 },
      { dim: "urbanization", key: "suburban", w: 0.25 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "ethnicity", key: "white_british", w: 0.2 },
    ],
    civicMultiplier: 0.85,
  },
  /**
   * Green Activists: climate-first progressive identity.
   * Degree-plus, young, urban, mid income.
   */
  green_activists: {
    weights: [
      { dim: "education", key: "degree_plus", w: 0.45 },
      { dim: "age", key: "young", w: 0.3 },
      { dim: "urbanization", key: "urban", w: 0.15 },
      { dim: "income", key: "middle", w: 0.1 },
    ],
    civicMultiplier: 0.92,
  },
  /**
   * Small Business & Self-Employed: entrepreneurs, sole traders.
   * High income, suburban, GCSE/A-level (practical not academic).
   */
  small_business: {
    weights: [
      { dim: "income", key: "high", w: 0.4 },
      { dim: "urbanization", key: "suburban", w: 0.3 },
      { dim: "education", key: "gcse_equivalent", w: 0.2 },
      { dim: "age", key: "mature", w: 0.1 },
    ],
    civicMultiplier: 1.0,
  },
  /**
   * New Britons & Minorities: British Asian, Black British, recent immigrants.
   * Non-white ethnicity, urban, low-to-middle income.
   */
  new_britons: {
    weights: [
      { dim: "ethnicity", key: "asian_british", w: 0.35 },
      { dim: "ethnicity", key: "black_british", w: 0.3 },
      { dim: "ethnicity", key: "mixed", w: 0.15 },
      { dim: "urbanization", key: "urban", w: 0.12 },
      { dim: "income", key: "low", w: 0.08 },
    ],
    civicMultiplier: 0.8,
  },
};

// ── Default leans (archetype priors, from ukDemographicCategories.ts) ─────────

const DEFAULT_LEANS: Record<GroupId, { economicLean: number; socialLean: number }> = {
  post_industrial_workers: { economicLean: -2, socialLean: 2 },
  urban_progressives: { economicLean: -3, socialLean: -4 },
  suburban_homeowners: { economicLean: 2, socialLean: 2 },
  young_renters: { economicLean: -1, socialLean: -4 },
  rural_traditionalists: { economicLean: 3, socialLean: 3 },
  retirees: { economicLean: 1, socialLean: 3 },
  public_sector: { economicLean: -3, socialLean: -2 },
  moderate_centrists: { economicLean: 0, socialLean: -2 },
  populist_right: { economicLean: 1, socialLean: 4 },
  green_activists: { economicLean: -4, socialLean: -5 },
  small_business: { economicLean: 3, socialLean: 1 },
  new_britons: { economicLean: -2, socialLean: -1 },
};

// ── Per-era positions: how each census key leaned in that political era ────────
//
// Scale: economicLean -5 (redistribution) to +5 (free market)
//        socialLean   -5 (progressive) to +5 (traditional/conservative)
//
// Historical basis:
//   1979: Thatcher election — class politics dominant. Working class / low education /
//         industrial = strongly economic LEFT. High earners = RIGHT. Social: rural
//         traditional, senior traditional. Few graduates (left lean not yet formed).
//
//   1991: Post-Thatcher recession. Education polarisation beginning. Miners defeated.
//         Economic discontent in industrial North but social conservatism persistent.
//         John Major era — centre right.
//
//   1999: New Labour 2nd year. Blair landslide was 1997. Graduate expansion starts.
//         Working class less reliably Labour (some moved to BNP/Ukip). Ethnic minority
//         communities very strongly Labour. Degree-plus left alignment emerging.
//
//   2007: Blair exit / Brown. Iraq war disillusionment. Degree-plus moves further left.
//         Income.high = more right. Working class dissatisfaction growing.
//
//   2019: Brexit realignment complete. Education is the dominant cleavage.
//         degree_plus → strongly LEFT (Remain); no_qualifications → RIGHT (Leave).
//         Working class income.low: split but social lean very RIGHT.
//         London, diverse, urban = strongly left. "Red Wall" right drift.
//
//   2023: Post-Truss economic disaster. Conservative collapse. Labour surge.
//         Similar structure to 2019 but income.middle/high more volatile (cost of living).
//         Degree-plus remains strong left. No_qualifications right (Reform/Tory).

type DimPositions = Record<string, DemographicPosition>;
type EraPositions = Record<string, DimPositions>;

const POSITIONS_1953: EraPositions = {
  // 1953 — post-war class politics at its most binary. NHS and welfare state just
  // built; Churchill's Conservatives in power since 1951. Near-tie elections either
  // side (1951 Con 48.0% / Lab 48.8%; 1955 Con 49.7% / Lab 46.4%).
  //
  // Fixes #3755, where every region displayed left of centre. The economics were
  // broadly right; the fault was the SOCIAL LEVEL. `getDisplayLean` takes whichever
  // axis is larger in magnitude, so the social level acts as the threshold the
  // economic axis crosses: regions more left than it read left, the rest read right.
  // This era sat at ~0.26 while every region's economic lean was 0.48–1.14, so the
  // economic axis always won and the country came out uniformly left — it could not
  // return the government Britain actually had. The level now sits ~0.7, in line with
  // the other eras, which splits the industrial North and London from the shire South.
  //
  // Welsh rurality is also no longer treated as Tory shire: the valleys were chapel
  // Liberal-Labour, so `rural` pulls right less hard than in later eras.
  //
  // Targets live in seeds/calibration/targets.ts; anchors in uk1953.test.ts.
  ethnicity: {
    white_british: { economicLean: 0.0, socialLean: 0.66 }, // 98%+ of every region; lean set by income/class
    asian_british: { economicLean: -2.0, socialLean: 0.16 }, // Very small post-Partition arrivals, Labour
    black_british: { economicLean: -2.5, socialLean: 0.16 }, // Tiny Windrush cohort (1948–1953)
    mixed: { economicLean: -1.5, socialLean: 0.26 },
    other: { economicLean: -1.0, socialLean: 0.36 },
  },
  age: {
    young: { economicLean: -2.0, socialLean: 0.06 }, // WWII veterans-younger cohort; class-aligned Labour
    mid: { economicLean: -1.5, socialLean: 0.36 }, // Core trade union generation; Labour heartland
    mature: { economicLean: -1.0, socialLean: 0.76 }, // Pre-war skilled workers; Labour but with deference
    senior: { economicLean: 0.5, socialLean: 1.16 }, // Edwardian/WWI generation; deference to establishment
  },
  education: {
    no_qualifications: { economicLean: -3.0, socialLean: 0.66 }, // Working-class majority; solidly Labour
    gcse_equivalent: { economicLean: -1.5, socialLean: 0.56 },
    a_level_equivalent: { economicLean: 0.0, socialLean: 0.56 }, // Grammar-school lower-middle; swing
    degree_plus: { economicLean: 1.5, socialLean: 0.46 }, // Small professional elite; Tory-leaning
  },
  income: {
    low: { economicLean: -4.6, socialLean: 0.56 }, // Industrial working class; peak union Labour
    middle: { economicLean: -0.5, socialLean: 0.66 }, // Aspirational lower-middle; slight Labour
    high: { economicLean: 5.0, socialLean: 0.86 }, // Business class; solidly Tory
  },
  urbanization: {
    urban: { economicLean: -4.0, socialLean: 0.46 }, // Industrial cities; peak Labour
    suburban: { economicLean: 1.5, socialLean: 0.76 }, // Inter-war suburbs; Tory lean
    rural: { economicLean: 1.6, socialLean: 0.96 }, // Traditional Tory rural; squirearchy
  },
};

const POSITIONS_1979: EraPositions = {
  // Calibration-fitted to the UK 1979 GE regional pattern (class politics: union-industrial income.low/urban strongly left; suburban/rural south socially traditional right). See scripts/calibration-report.ts.
  ethnicity: {
    white_british: { economicLean: -0.7, socialLean: 0.5 },
    asian_british: { economicLean: -2.5, socialLean: -0.3 },
    black_british: { economicLean: -3.0, socialLean: -0.5 },
    mixed: { economicLean: -1.5, socialLean: -0.2 },
    other: { economicLean: -1.0, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -1.5, socialLean: -0.4 },
    mid: { economicLean: -1.5, socialLean: -0.6 },
    mature: { economicLean: -1.6, socialLean: 0.9 },
    senior: { economicLean: 0.2, socialLean: 1.9 },
  },
  education: {
    no_qualifications: { economicLean: -2.0, socialLean: 0.3 },
    gcse_equivalent: { economicLean: -0.5, socialLean: 0.1 },
    a_level_equivalent: { economicLean: 0.6, socialLean: 1.0 },
    degree_plus: { economicLean: 0.7, socialLean: 0.0 },
  },
  income: {
    low: { economicLean: -3.7, socialLean: -0.6 },
    middle: { economicLean: -0.8, socialLean: -0.1 },
    high: { economicLean: 4.5, socialLean: 0.9 },
  },
  urbanization: {
    urban: { economicLean: -3.5, socialLean: 1.3 },
    suburban: { economicLean: 0.7, socialLean: 1.5 },
    rural: { economicLean: 2.5, socialLean: 0.7 },
  },
};

const POSITIONS_1991: EraPositions = {
  // Calibration-fitted to the UK 1992 GE regional pattern (Major era: industrial North still Labour; suburban/rural south right via social traditionalism).
  ethnicity: {
    white_british: { economicLean: 1.9, socialLean: 1.6 },
    asian_british: { economicLean: -2.0, socialLean: -0.3 },
    black_british: { economicLean: -4.5, socialLean: -0.5 },
    mixed: { economicLean: -3.6, socialLean: -0.3 },
    other: { economicLean: -2.8, socialLean: 0.0 },
  },
  age: {
    young: { economicLean: -4.5, socialLean: -0.4 },
    mid: { economicLean: -2.3, socialLean: 3.1 },
    mature: { economicLean: 3.0, socialLean: 1.5 },
    senior: { economicLean: -4.5, socialLean: 3.2 },
  },
  education: {
    no_qualifications: { economicLean: -2.9, socialLean: 1.2 },
    gcse_equivalent: { economicLean: -2.8, socialLean: -0.4 },
    a_level_equivalent: { economicLean: -2.0, socialLean: 2.3 },
    degree_plus: { economicLean: -3.3, socialLean: 0.5 },
  },
  income: {
    low: { economicLean: -4.5, socialLean: 0.1 },
    middle: { economicLean: -4.5, socialLean: -3.1 },
    high: { economicLean: 4.5, socialLean: 2.8 },
  },
  urbanization: {
    urban: { economicLean: -4.5, socialLean: 1.6 },
    suburban: { economicLean: 3.5, socialLean: 2.1 },
    rural: { economicLean: -2.9, socialLean: 1.3 },
  },
};

const POSITIONS_1999: EraPositions = {
  // Calibration-fitted to the UK 1997 GE regional pattern (Blair landslide: broad left shift, only the rural/senior South West stays right).
  ethnicity: {
    white_british: { economicLean: -3.0, socialLean: 2.5 },
    asian_british: { economicLean: -3.0, socialLean: -0.7 },
    black_british: { economicLean: -3.0, socialLean: -1.2 },
    mixed: { economicLean: -3.0, socialLean: -1.2 },
    other: { economicLean: -3.0, socialLean: -0.7 },
  },
  age: {
    young: { economicLean: -3.0, socialLean: -2.2 },
    mid: { economicLean: -2.5, socialLean: -0.5 },
    mature: { economicLean: 0.7, socialLean: 1.3 },
    senior: { economicLean: -0.6, socialLean: 4.4 },
  },
  education: {
    no_qualifications: { economicLean: -3.0, socialLean: -1.7 },
    gcse_equivalent: { economicLean: -3.0, socialLean: 2.0 },
    a_level_equivalent: { economicLean: 0.4, socialLean: -0.2 },
    degree_plus: { economicLean: -3.0, socialLean: 2.6 },
  },
  income: {
    low: { economicLean: -3.0, socialLean: -1.2 },
    middle: { economicLean: -3.0, socialLean: -1.7 },
    high: { economicLean: 4.8, socialLean: 4.8 },
  },
  urbanization: {
    urban: { economicLean: -3.0, socialLean: -0.9 },
    suburban: { economicLean: -2.8, socialLean: 0.3 },
    rural: { economicLean: -3.0, socialLean: 2.6 },
  },
};

const POSITIONS_2007: EraPositions = {
  // Calibration-fitted to the UK 2005 GE regional pattern (late Blair: North/LON left; South East/East/South West right).
  ethnicity: {
    white_british: { economicLean: 1.0, socialLean: -0.5 },
    asian_british: { economicLean: -2.5, socialLean: 0.9 },
    black_british: { economicLean: -3.0, socialLean: -1.0 },
    mixed: { economicLean: -2.0, socialLean: -1.0 },
    other: { economicLean: -1.5, socialLean: -0.5 },
  },
  age: {
    young: { economicLean: -3.3, socialLean: -5.0 },
    mid: { economicLean: -0.7, socialLean: 0.8 },
    mature: { economicLean: 1.0, socialLean: 1.8 },
    senior: { economicLean: 1.3, socialLean: 4.9 },
  },
  education: {
    no_qualifications: { economicLean: -4.5, socialLean: 3.2 },
    gcse_equivalent: { economicLean: -2.6, socialLean: -3.2 },
    a_level_equivalent: { economicLean: -3.5, socialLean: 1.3 },
    degree_plus: { economicLean: 1.7, socialLean: -0.7 },
  },
  income: {
    low: { economicLean: -3.9, socialLean: -1.8 },
    middle: { economicLean: -3.3, socialLean: -1.9 },
    high: { economicLean: 1.7, socialLean: 2.4 },
  },
  urbanization: {
    urban: { economicLean: -4.2, socialLean: 4.3 },
    suburban: { economicLean: 0.2, socialLean: 3.9 },
    rural: { economicLean: -3.7, socialLean: 2.8 },
  },
};

// 2019 era (also used for the 2019 census import, which is the 2021 ONS base)
const POSITIONS_2019: EraPositions = {
  // Calibration-fitted to the UK 2019 GE regional pattern (Brexit realignment: education is the dominant cleavage; red-wall regions right of WAL/SCO/LON). Some keys act as regional proxies rather than literal survey positions.
  ethnicity: {
    white_british: { economicLean: -5, socialLean: 1.6 },
    asian_british: { economicLean: -0.4, socialLean: 1.9 },
    black_british: { economicLean: -3.0, socialLean: -1.4 },
    mixed: { economicLean: -2.1, socialLean: -1.8 },
    other: { economicLean: -2.0, socialLean: -1.4 },
  },
  age: {
    young: { economicLean: -2.5, socialLean: -2.9 },
    mid: { economicLean: 0.2, socialLean: -0.8 },
    mature: { economicLean: 0.8, socialLean: 1.6 },
    senior: { economicLean: 0.2, socialLean: 4.8 },
  },
  education: {
    no_qualifications: { economicLean: 2.0, socialLean: 3.9 },
    gcse_equivalent: { economicLean: -0.6, socialLean: 1.9 },
    a_level_equivalent: { economicLean: -1.1, socialLean: 0.8 },
    degree_plus: { economicLean: -4.4, socialLean: -3.6 },
  },
  income: {
    low: { economicLean: -1.5, socialLean: 1.2 },
    middle: { economicLean: 1.8, socialLean: -0.4 },
    high: { economicLean: 3.9, socialLean: 0.4 },
  },
  urbanization: {
    urban: { economicLean: 4.7, socialLean: -3.6 },
    suburban: { economicLean: 2.5, socialLean: 0.3 },
    rural: { economicLean: -1.4, socialLean: 2.6 },
  },
};

const POSITIONS_2023: EraPositions = {
  // Calibration-fitted to the UK 2024 GE regional pattern (post-Truss Labour landslide: most regions left; SEE/EAE/SWE residual right).
  ethnicity: {
    white_british: { economicLean: -3.0, socialLean: -5.0 },
    asian_british: { economicLean: -2.0, socialLean: -0.4 },
    black_british: { economicLean: -3.0, socialLean: -1.5 },
    mixed: { economicLean: -2.0, socialLean: -2.2 },
    other: { economicLean: -2.0, socialLean: -1.5 },
  },
  age: {
    young: { economicLean: -1.3, socialLean: -4.3 },
    mid: { economicLean: 2.4, socialLean: -4.1 },
    mature: { economicLean: 5.0, socialLean: -0.2 },
    senior: { economicLean: 0.8, socialLean: 3.2 },
  },
  education: {
    no_qualifications: { economicLean: -0.7, socialLean: 3.6 },
    gcse_equivalent: { economicLean: -2.4, socialLean: 1.1 },
    a_level_equivalent: { economicLean: -2.3, socialLean: 0.0 },
    degree_plus: { economicLean: -5.0, socialLean: 0.4 },
  },
  income: {
    low: { economicLean: -1.7, socialLean: 0.3 },
    middle: { economicLean: -0.7, socialLean: -4.4 },
    high: { economicLean: 4.6, socialLean: 4.9 },
  },
  urbanization: {
    urban: { economicLean: -2.8, socialLean: 4.3 },
    suburban: { economicLean: 5.0, socialLean: 3.4 },
    rural: { economicLean: -0.1, socialLean: 4.4 },
  },
};

const ERA_POSITIONS: Record<EraId, EraPositions> = {
  "1953": POSITIONS_1953,
  "1979": POSITIONS_1979,
  "1991": POSITIONS_1991,
  "1999": POSITIONS_1999,
  "2007": POSITIONS_2007,
  "2019": POSITIONS_2019,
  "2023": POSITIONS_2023,
};

// ── Census conversion ─────────────────────────────────────────────────────────
// UKRegionLayer1 is already Record<dim, Record<key, number>> — just reindex.

function convertCensus(
  raw: Record<string, UKRegionLayer1>
): Record<string, Record<string, Record<string, number>>> {
  return Object.fromEntries(
    Object.entries(raw).map(([regionId, layer1]) => [
      regionId,
      {
        ethnicity: layer1.ethnicity as unknown as Record<string, number>,
        age: layer1.age as unknown as Record<string, number>,
        education: layer1.education as unknown as Record<string, number>,
        income: layer1.income as unknown as Record<string, number>,
        urbanization: layer1.urbanization as unknown as Record<string, number>,
      },
    ])
  );
}

const ERA_CENSUS: Record<EraId, Record<string, UKRegionLayer1>> = {
  "1953": ukRegionCensusData1953,
  "1979": ukRegionCensusData1979,
  "1991": ukRegionCensusData1991,
  "1999": ukRegionCensusData1999,
  "2007": ukRegionCensusData2007,
  "2019": ukRegionCensusData, // 2021 ONS base, used for 2019 era
  "2023": ukRegionCensusData2023,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getUkModel(era: EraId): CountryLayer1Model {
  const census = convertCensus(ERA_CENSUS[era]);
  const positions = ERA_POSITIONS[era];

  return {
    countryId: "UK",
    categoryId: "uk_voterGroups",
    groupIds: [...UK_GROUP_IDS],
    dims: ["ethnicity", "age", "education", "income", "urbanization"],
    turnoutRates: TURNOUT_RATES,
    positions,
    composition: COMPOSITION as Record<string, CountryLayer1Model["composition"][string]>,
    defaultLeans: DEFAULT_LEANS as Record<string, { economicLean: number; socialLean: number }>,
    census,
  };
}

// ── Backwards-compat export (2019 era, single model) ─────────────────────────
// Keep ukLayer1Model and ukGroupIds exports so the existing uk.test.ts still
// compiles after the overwrite.

export const ukLayer1Model: CountryLayer1Model = getUkModel("2019");
export const ukGroupIds = [...UK_GROUP_IDS];
