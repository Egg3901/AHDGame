/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data (e.g. the 2019 `stateMetrics` array). All values are
 * authored for 2007 directly. Changing the 2019/2023 (or any other) seed must
 * never alter 2007. Type-only imports and same-era constants are allowed.
 *
 * SCALE NOTE (read before wiring into scoring): 2007 is a *pre-recession,
 * pre-ACA, pre-smartphone-saturation* world and its real values sit on a very
 * different scale from 2019/2023. The big era anchors:
 *   - median household income national ≈ $50,233 (≈62% of the 2023 ≈$80,610)
 *   - home broadband ≈ 50% of households (vs ≈83% in 2023)
 *   - uninsured rate ≈ 15.3% (vs ≈9.2% in 2023 — no ACA yet)
 *   - renewable electricity ≈ 8.4% (vs ≈22% in 2023 — mostly hydro)
 *   - carbon emissions ≈ 19.5 t/capita (vs ≈14 in 2023)
 *   - HS grad rate (AFGR) ≈ 74% (vs ≈87% in 2023)
 * `metricScoring.THRESHOLDS` / `medianIncomeThreshold` are still 2019-nominal
 * and only era-scale for the "1991" prefix, so these era-true values will
 * MIS-SCORE until a 2007 era band is added (tracked as a deferred scoring-
 * rebalance flag, NOT fixed here — seeds first).
 */
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";
import { states2007 } from "./states2007";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function mv(value: number, trend?: number): StateMetricValue {
  return trend !== undefined ? { value, trend } : { value };
}

// ---------------------------------------------------------------------------
// Real 2007 per-state series
// ---------------------------------------------------------------------------

/**
 * BLS LAUS 2007 annual-average unemployment rate (%) by state.
 * Pre-recession trough; national average 4.6%. Michigan already elevated
 * (auto-sector decline). Source: BLS Local Area Unemployment Statistics, 2007.
 */
const UNEMP_2007: Record<string, number> = {
  AL: 4.0,
  AK: 6.3,
  AZ: 3.8,
  AR: 5.3,
  CA: 5.4,
  CO: 3.9,
  CT: 4.6,
  DE: 3.5,
  DC: 5.7,
  FL: 4.1,
  GA: 4.7,
  HI: 2.7,
  ID: 3.0,
  IL: 5.1,
  IN: 4.6,
  IA: 3.8,
  KS: 4.4,
  KY: 5.5,
  LA: 3.9,
  ME: 4.7,
  MD: 3.6,
  MA: 4.6,
  MI: 7.1,
  MN: 4.7,
  MS: 6.3,
  MO: 5.1,
  MT: 3.5,
  NE: 3.0,
  NV: 4.8,
  NH: 3.6,
  NJ: 4.4,
  NM: 3.6,
  NY: 4.6,
  NC: 4.8,
  ND: 3.2,
  OH: 5.6,
  OK: 4.1,
  OR: 5.2,
  PA: 4.4,
  RI: 5.2,
  SC: 5.7,
  SD: 3.0,
  TN: 4.8,
  TX: 4.4,
  UT: 2.7,
  VT: 4.0,
  VA: 3.1,
  WA: 4.6,
  WV: 4.5,
  WI: 4.9,
  WY: 2.9,
};

/**
 * Census ACS 2007 median household income (USD).
 * National median ≈ $50,233. Source: U.S. Census Bureau, ACS 2007 1-Year
 * Estimates (Table B19013).
 */
const MEDIAN_INCOME_2007: Record<string, number> = {
  AL: 40554,
  AK: 64333,
  AZ: 49889,
  AR: 38134,
  CA: 59948,
  CO: 55212,
  CT: 65967,
  DE: 54610,
  DC: 54317,
  FL: 47804,
  GA: 49136,
  HI: 63746,
  ID: 46253,
  IL: 54124,
  IN: 47448,
  IA: 47292,
  KS: 47451,
  KY: 40267,
  LA: 40926,
  ME: 45888,
  MD: 68080,
  MA: 62365,
  MI: 47950,
  MN: 55082,
  MS: 36338,
  MO: 45114,
  MT: 43654,
  NE: 47085,
  NV: 55062,
  NH: 62369,
  NJ: 67035,
  NM: 41452,
  NY: 53514,
  NC: 44670,
  ND: 43753,
  OH: 46597,
  OK: 41567,
  OR: 48730,
  PA: 48576,
  RI: 53568,
  SC: 43329,
  SD: 43424,
  TN: 42367,
  TX: 47548,
  UT: 55109,
  VT: 49907,
  VA: 59562,
  WA: 55591,
  WV: 37060,
  WI: 50578,
  WY: 51731,
};

/**
 * Census 2007 poverty rate (%). National ≈ 12.5%.
 * Source: U.S. Census Bureau, ACS 2007 1-Year (Table B17001).
 */
const POVERTY_2007: Record<string, number> = {
  AL: 16.9,
  AK: 8.9,
  AZ: 14.2,
  AR: 17.9,
  CA: 12.4,
  CO: 12.0,
  CT: 7.9,
  DE: 10.5,
  DC: 16.4,
  FL: 12.1,
  GA: 14.3,
  HI: 8.0,
  ID: 12.1,
  IL: 11.9,
  IN: 12.3,
  IA: 11.0,
  KS: 11.2,
  KY: 17.3,
  LA: 18.6,
  ME: 12.0,
  MD: 8.3,
  MA: 9.9,
  MI: 14.0,
  MN: 9.5,
  MS: 20.6,
  MO: 13.0,
  MT: 14.1,
  NE: 11.2,
  NV: 10.7,
  NH: 7.1,
  NJ: 8.6,
  NM: 18.1,
  NY: 13.7,
  NC: 14.3,
  ND: 12.1,
  OH: 13.1,
  OK: 15.9,
  OR: 12.9,
  PA: 11.6,
  RI: 12.0,
  SC: 15.0,
  SD: 13.1,
  TN: 15.9,
  TX: 16.3,
  UT: 9.7,
  VT: 10.1,
  VA: 9.9,
  WA: 11.4,
  WV: 16.9,
  WI: 10.8,
  WY: 8.7,
};

/**
 * BEA 2007 real state GDP growth (%), chain-type. National real GDP growth
 * 2007 ≈ +1.9% (deceleration into the recession; housing-bubble states already
 * softening). Source: BEA Regional Economic Accounts, GDP by State.
 */
const GDP_GROWTH_2007: Record<string, number> = {
  AL: 1.5,
  AK: 2.6,
  AZ: 2.8,
  AR: 1.0,
  CA: 1.5,
  CO: 3.2,
  CT: 1.6,
  DE: -1.5,
  DC: 2.7,
  FL: 0.5,
  GA: 1.1,
  HI: 1.9,
  ID: 3.0,
  IL: 1.6,
  IN: 1.4,
  IA: 3.3,
  KS: 2.2,
  KY: 1.0,
  LA: 0.7,
  ME: 0.8,
  MD: 1.9,
  MA: 2.6,
  MI: -1.2,
  MN: 1.9,
  MS: 1.0,
  MO: 1.2,
  MT: 2.6,
  NE: 3.4,
  NV: 1.7,
  NH: 1.9,
  NJ: 1.3,
  NM: 2.5,
  NY: 2.8,
  NC: 2.6,
  ND: 4.4,
  OH: 0.6,
  OK: 4.0,
  OR: 4.7,
  PA: 1.9,
  RI: 0.2,
  SC: 1.6,
  SD: 2.9,
  TN: 1.9,
  TX: 4.1,
  UT: 3.6,
  VT: 1.4,
  VA: 2.5,
  WA: 3.7,
  WV: 1.4,
  WI: 1.4,
  WY: 3.0,
};

/**
 * 2007 life expectancy at birth by state (years). National ≈ 77.9.
 * Source: CDC NCHS / IHME state life-tables, 2007 vintage.
 */
const LIFE_EXPECTANCY_2007: Record<string, number> = {
  AL: 74.8,
  AK: 78.3,
  AZ: 79.0,
  AR: 75.6,
  CA: 79.8,
  CO: 79.5,
  CT: 80.1,
  DE: 77.8,
  DC: 75.0,
  FL: 79.4,
  GA: 76.4,
  HI: 81.5,
  ID: 79.1,
  IL: 78.3,
  IN: 77.0,
  IA: 79.2,
  KS: 78.4,
  KY: 75.5,
  LA: 74.9,
  ME: 78.7,
  MD: 77.8,
  MA: 79.9,
  MI: 77.5,
  MN: 80.5,
  MS: 73.6,
  MO: 76.9,
  MT: 78.4,
  NE: 79.4,
  NV: 77.6,
  NH: 79.7,
  NJ: 78.7,
  NM: 78.2,
  NY: 79.3,
  NC: 76.9,
  ND: 79.5,
  OH: 77.0,
  OK: 75.2,
  OR: 79.1,
  PA: 77.5,
  RI: 79.2,
  SC: 75.7,
  SD: 78.9,
  TN: 75.6,
  TX: 78.0,
  UT: 79.9,
  VT: 79.7,
  VA: 77.6,
  WA: 79.6,
  WV: 75.2,
  WI: 79.4,
  WY: 78.0,
};

/**
 * 2007 home broadband subscription (% of households). National ≈ 50%
 * (Pew Internet "Home Broadband 2007" ≈ 47% of adults; household ≈ 50%).
 * THE defining 2007 infrastructure anchor — broadband was still rolling out.
 * Source: Pew Internet & American Life Project, 2007; FCC Form 477.
 */
const BROADBAND_2007: Record<string, number> = {
  AL: 41,
  AK: 53,
  AZ: 51,
  AR: 38,
  CA: 57,
  CO: 58,
  CT: 60,
  DE: 56,
  DC: 60,
  FL: 52,
  GA: 47,
  HI: 55,
  ID: 48,
  IL: 52,
  IN: 46,
  IA: 45,
  KS: 48,
  KY: 41,
  LA: 40,
  ME: 50,
  MD: 60,
  MA: 61,
  MI: 50,
  MN: 55,
  MS: 35,
  MO: 46,
  MT: 44,
  NE: 47,
  NV: 56,
  NH: 60,
  NJ: 62,
  NM: 44,
  NY: 56,
  NC: 46,
  ND: 44,
  OH: 48,
  OK: 42,
  OR: 56,
  PA: 52,
  RI: 57,
  SC: 43,
  SD: 45,
  TN: 43,
  TX: 49,
  UT: 56,
  VT: 51,
  VA: 56,
  WA: 60,
  WV: 38,
  WI: 50,
  WY: 47,
};

/**
 * 2007 cost-of-living index (ACCRA/C2ER composite). National = 100.
 * Source: C2ER Cost of Living Index, 2007 annual.
 */
const COST_OF_LIVING_2007: Record<string, number> = {
  AL: 92,
  AK: 132,
  AZ: 102,
  AR: 90,
  CA: 138,
  CO: 103,
  CT: 124,
  DE: 103,
  DC: 140,
  FL: 105,
  GA: 93,
  HI: 165,
  ID: 96,
  IL: 99,
  IN: 92,
  IA: 92,
  KS: 90,
  KY: 91,
  LA: 95,
  ME: 113,
  MD: 122,
  MA: 130,
  MI: 97,
  MN: 101,
  MS: 90,
  MO: 90,
  MT: 100,
  NE: 90,
  NV: 107,
  NH: 119,
  NJ: 127,
  NM: 99,
  NY: 133,
  NC: 96,
  ND: 95,
  OH: 95,
  OK: 89,
  OR: 110,
  PA: 102,
  RI: 122,
  SC: 97,
  SD: 99,
  TN: 90,
  TX: 92,
  UT: 98,
  VT: 119,
  VA: 105,
  WA: 110,
  WV: 95,
  WI: 98,
  WY: 100,
};

/**
 * 2007 population growth (% annual, 2006→2007 Census estimates).
 * Sun-Belt boom still running; Gulf states recovering post-Katrina.
 */
const POP_GROWTH_2007: Record<string, number> = {
  AL: 0.9,
  AK: 1.1,
  AZ: 2.8,
  AR: 1.0,
  CA: 1.1,
  CO: 2.0,
  CT: 0.2,
  DE: 1.5,
  DC: 0.5,
  FL: 1.7,
  GA: 2.2,
  HI: 0.7,
  ID: 2.4,
  IL: 0.4,
  IN: 0.6,
  IA: 0.5,
  KS: 0.6,
  KY: 0.9,
  LA: 2.8,
  ME: 0.2,
  MD: 0.5,
  MA: 0.2,
  MI: -0.3,
  MN: 0.7,
  MS: 0.9,
  MO: 0.7,
  MT: 1.3,
  NE: 0.7,
  NV: 2.9,
  NH: 0.5,
  NJ: 0.3,
  NM: 1.5,
  NY: 0.0,
  NC: 2.2,
  ND: 0.3,
  OH: 0.1,
  OK: 1.1,
  OR: 1.5,
  PA: 0.3,
  RI: -0.5,
  SC: 2.1,
  SD: 0.9,
  TN: 1.4,
  TX: 2.0,
  UT: 2.6,
  VT: 0.1,
  VA: 1.2,
  WA: 1.5,
  WV: 0.2,
  WI: 0.5,
  WY: 1.7,
};

/** Urbanization (% urban; 2000 decennial, the 2007-era reference). National ≈ 79%. */
const URBANIZATION_2007: Record<string, number> = {
  AL: 55,
  AK: 66,
  AZ: 88,
  AR: 52,
  CA: 95,
  CO: 84,
  CT: 88,
  DE: 80,
  DC: 100,
  FL: 89,
  GA: 72,
  HI: 91,
  ID: 66,
  IL: 88,
  IN: 71,
  IA: 61,
  KS: 71,
  KY: 56,
  LA: 73,
  ME: 40,
  MD: 86,
  MA: 91,
  MI: 75,
  MN: 71,
  MS: 49,
  MO: 69,
  MT: 54,
  NE: 70,
  NV: 92,
  NH: 59,
  NJ: 94,
  NM: 75,
  NY: 87,
  NC: 60,
  ND: 56,
  OH: 77,
  OK: 65,
  OR: 79,
  PA: 77,
  RI: 91,
  SC: 60,
  SD: 52,
  TN: 64,
  TX: 83,
  UT: 88,
  VT: 38,
  VA: 73,
  WA: 82,
  WV: 46,
  WI: 68,
  WY: 65,
};

/** Median age by state (Census 2007 estimates). National ≈ 36.7. */
const MEDIAN_AGE_2007: Record<string, number> = {
  AL: 37.5,
  AK: 33.3,
  AZ: 34.7,
  AR: 37.0,
  CA: 34.8,
  CO: 35.9,
  CT: 39.5,
  DE: 38.4,
  DC: 35.0,
  FL: 40.1,
  GA: 35.0,
  HI: 38.6,
  ID: 34.1,
  IL: 36.2,
  IN: 36.6,
  IA: 38.0,
  KS: 36.0,
  KY: 37.5,
  LA: 35.4,
  ME: 41.6,
  MD: 37.7,
  MA: 38.7,
  MI: 37.6,
  MN: 37.3,
  MS: 35.5,
  MO: 37.6,
  MT: 39.8,
  NE: 36.0,
  NV: 35.5,
  NH: 40.1,
  NJ: 38.6,
  NM: 35.8,
  NY: 38.0,
  NC: 36.4,
  ND: 36.8,
  OH: 38.3,
  OK: 36.0,
  OR: 37.9,
  PA: 39.9,
  RI: 39.0,
  SC: 37.0,
  SD: 36.6,
  TN: 37.6,
  TX: 33.2,
  UT: 28.6,
  VT: 40.7,
  VA: 36.9,
  WA: 37.0,
  WV: 40.4,
  WI: 38.0,
  WY: 37.0,
};

// ---------------------------------------------------------------------------
// 2007 soft-index national baselines (documented 2007 estimates — authored as
// 2007 constants, NOT carried from 2019). Per-state spread is applied in the
// builder from real income/urbanization tiers, same method the 2023 seed uses.
// ---------------------------------------------------------------------------
const BASELINE_2007 = {
  // Media Information — pre-social-media-dominance (Facebook just opened to all
  // in 2006; Twitter mid-2006). Polarization lower than 2019/2023.
  mediaPolarization: 42,
  disinformationRisk: 30, // pre-bot-farm era; mostly cable-news framing
  pressFreedom: 72, // RSF 2007: US recovering from mid-2000s low
  newsTrust: 47, // Gallup 2007: ~47% trust in mass media (much higher than 2023's ~32)
  socialMediaSentiment: 0,

  // Public Safety — late-2000s crime still elevated vs 2019/2023 lows.
  crimeRate: 3264, // FBI UCR 2007 property crime per 100k
  violentCrimeRate: 467, // FBI UCR 2007 violent crime per 100k
  policePerCapita: 2.4,
  incarcerationRate: 506, // 2007 near the historical peak (vs ~450 in 2023)
  recidivismRate: 45,
  publicSafetyConfidence: 58,

  // Governance
  governmentTransparency: 58,
  budgetBalance: 0.2, // FY2007 federal deficit small (~1.2% GDP); state budgets pre-crash healthy
  debtToGdp: 36, // federal debt/GDP ≈ 36% in 2007 (vs ≈120% in 2023)
  corruptionIndex: 27, // TI CPI 2007 US ≈ 7.2/10 → low corruption
  voterTurnout: 48, // 2006 midterm ≈ 40% VEP / 2008 ≈ 62%; mid-cycle blend
  publicTrust: 40, // higher pre-2008-crash than 2019/2023
  coDeterminationQuality: 45,

  // Education — 2007 scale is materially lower than 2023.
  highSchoolGradRate: 74, // AFGR 2006-07 ≈ 74% (vs ≈87% in 2023)
  universityEnrollment: 56,
  testPerformance: 98, // NAEP 2007
  educationSpending: 9600, // NCES 2006-07 per-pupil ≈ $9,600 (vs ≈$14,600 in 2023)
  literacyRate: 78,
  workforceSkill: 58,
  apprenticeshipRate: 2.2,

  // Environment — pre-renewables-buildout.
  airQuality: 28, // worse than 2023; more coal generation
  renewableEnergy: 8.4, // EIA 2007 renewable electricity share (mostly hydro)
  carbonEmissions: 19.5, // 2007 CO2 ≈ 19.5 t/capita (vs ≈14 in 2023)
  recyclingRate: 25, // EPA 2007 MSW recycling ≈ 25%
  climateResilience: 52,
  protectedLand: 12,
  energyTransitionProgress: 15, // very early (vs ≈35 in 2023)

  // Social
  socialMobility: 56,
  incomeInequality: 44, // Gini 2007 ≈ 0.463
  homelessnessRate: 9, // HUD 2007 PIT ≈ 0.22% population
  foodInsecurity: 11.1, // USDA 2007 ≈ 11.1%
  civicParticipation: 54,
  socialCohesion: 58,
  housingSupplyGrowth: 1.4, // 2007 still elevated permits pre-crash

  // Healthcare — pre-ACA; uninsured materially higher than 2019/2023.
  uninsuredRate: 15.3, // Census 2007 ≈ 15.3% (vs ≈9.2% in 2023)
  affordabilityIndex: 52,
  physicianRate: 2.5,
  preventableMortality: 360, // higher than 2023
  publicHealthPreparedness: 58,
};

// ---------------------------------------------------------------------------
// Tier assignments (1–5) from real 2007 income/broadband data.
// ---------------------------------------------------------------------------
function econTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_2007[stateId] ?? 50233;
  if (income >= 60000) return 5;
  if (income >= 53000) return 4;
  if (income >= 46000) return 3;
  if (income >= 41000) return 2;
  return 1;
}

function eduTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const bb = BROADBAND_2007[stateId] ?? 50;
  if (bb >= 58) return 5;
  if (bb >= 53) return 4;
  if (bb >= 47) return 3;
  if (bb >= 42) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Builder — mirrors build2023Metrics so the bundle shape is identical.
// ---------------------------------------------------------------------------
function build2007Metrics(stateId: string): StateMetrics {
  const et = econTier(stateId) - 1; // 0..4
  const ed = eduTier(stateId) - 1; // 0..4
  const urban = URBANIZATION_2007[stateId] ?? 79;
  const popGrowth = POP_GROWTH_2007[stateId] ?? 1.0;
  const medAge = MEDIAN_AGE_2007[stateId] ?? 36.7;
  const unemp = UNEMP_2007[stateId] ?? 4.6;
  const income = MEDIAN_INCOME_2007[stateId] ?? 50233;
  const poverty = POVERTY_2007[stateId] ?? 12.5;
  const gdpGrowth = GDP_GROWTH_2007[stateId] ?? 1.9;
  const lifeExp = LIFE_EXPECTANCY_2007[stateId] ?? 77.9;
  const broadband = BROADBAND_2007[stateId] ?? 50;
  const col = COST_OF_LIVING_2007[stateId] ?? 100;

  const leanMod = (et - 2) * 2; // -4 to +4

  // 2007 infra band keyed off broadband adoption (≈35–62 range this era).
  const infraTier = Math.round(1 + (broadband - 35) / 7);
  const infra = Math.max(0, Math.min(4, infraTier - 1));

  return withUniformMetricSet({
    _id: stateId,
    countryId: "US",

    economic: {
      unemploymentRate: mv(unemp),
      medianIncome: mv(income),
      gdpGrowth: mv(gdpGrowth),
      povertyRate: mv(poverty),
      costOfLiving: mv(col),
      smallBusinessFormation: mv([3.0, 4.0, 5.0, 6.0, 7.5][et]), // 2007 pre-crash formation higher
      laborParticipation: mv(66), // 2007 LFPR ≈ 66% (vs ≈63% in 2023)
      matchingFriction: mv(4),
      tradeBalance: mv(0),
      productivityGrowth: mv(Math.round(gdpGrowth * 0.55 * 10) / 10),
      rdIntensity: mv(1.2 + ed * 0.22), // 2007 R&D/GDP ≈ 2.6% national, lower per-state floor
      exportDependency: mv(30),
      manufacturingCompetitiveness: mv(Math.max(40, Math.min(92, [48, 58, 68, 78, 88][ed]))), // 2007 manufacturing stronger than 2023
    },

    education: {
      highSchoolGradRate: mv(BASELINE_2007.highSchoolGradRate + leanMod * 0.6),
      universityEnrollment: mv(BASELINE_2007.universityEnrollment + leanMod),
      testPerformance: mv(BASELINE_2007.testPerformance + leanMod * 1.5),
      educationSpending: mv(BASELINE_2007.educationSpending + leanMod * 400),
      literacyRate: mv(BASELINE_2007.literacyRate + leanMod * 0.5),
      workforceSkill: mv(BASELINE_2007.workforceSkill + leanMod * 2),
      apprenticeshipRate: mv(BASELINE_2007.apprenticeshipRate),
    },

    healthcare: {
      uninsuredRate: mv(Math.max(4, BASELINE_2007.uninsuredRate - leanMod * 1.1)),
      affordabilityIndex: mv(BASELINE_2007.affordabilityIndex + leanMod * 2),
      physicianRate: mv(BASELINE_2007.physicianRate + leanMod * 0.07),
      lifeExpectancy: mv(lifeExp),
      preventableMortality: mv(BASELINE_2007.preventableMortality - leanMod * 15),
      publicHealthPreparedness: mv(BASELINE_2007.publicHealthPreparedness + leanMod * 2),
    },

    infrastructure: {
      roadCondition: mv([50, 60, 70, 79, 87][infra]),
      broadbandAccess: mv(broadband),
      publicTransit: mv(Math.round(urban * 0.45 + infra * 4)),
      waterQuality: mv([76, 83, 89, 94, 97][infra]),
      powerGridReliability: mv([98.8, 99.2, 99.5, 99.75, 99.9][infra]),
      infrastructureInvestmentGap: mv([42, 34, 26, 18, 10][infra]),
    },

    publicSafety: {
      crimeRate: mv(BASELINE_2007.crimeRate + (urban - 79) * 8 - leanMod * 45),
      violentCrimeRate: mv(BASELINE_2007.violentCrimeRate + (urban - 79) * 2 - leanMod * 12),
      policePerCapita: mv(BASELINE_2007.policePerCapita + urban * 0.005),
      incarcerationRate: mv(BASELINE_2007.incarcerationRate - leanMod * 15),
      recidivismRate: mv(BASELINE_2007.recidivismRate - leanMod * 2),
      publicSafetyConfidence: mv(BASELINE_2007.publicSafetyConfidence + leanMod * 2),
    },

    environment: {
      airQuality: mv(Math.max(8, BASELINE_2007.airQuality - leanMod * 2 + urban * 0.05)),
      renewableEnergy: mv(Math.max(1, BASELINE_2007.renewableEnergy + leanMod * 1.2)),
      carbonEmissions: mv(BASELINE_2007.carbonEmissions - leanMod * 0.6),
      recyclingRate: mv(Math.max(8, BASELINE_2007.recyclingRate + leanMod * 2)),
      climateResilience: mv(BASELINE_2007.climateResilience + leanMod * 2),
      protectedLand: mv(BASELINE_2007.protectedLand + (100 - urban) * 0.08),
      energyTransitionProgress: mv(
        Math.max(2, BASELINE_2007.energyTransitionProgress + leanMod * 1.5)
      ),
    },

    social: {
      socialMobility: mv(BASELINE_2007.socialMobility + leanMod * 3),
      incomeInequality: mv(
        Math.max(28, Math.min(58, BASELINE_2007.incomeInequality - leanMod * 2))
      ),
      homelessnessRate: mv(
        Math.max(1, BASELINE_2007.homelessnessRate + (col - 100) * 0.06 + urban * 0.04)
      ),
      foodInsecurity: mv(Math.max(5, BASELINE_2007.foodInsecurity - leanMod * 0.8)),
      civicParticipation: mv(BASELINE_2007.civicParticipation + leanMod * 2),
      socialCohesion: mv(Math.max(25, BASELINE_2007.socialCohesion + leanMod * 2 - urban * 0.04)),
      housingSupplyGrowth: mv(BASELINE_2007.housingSupplyGrowth + popGrowth * 0.3),
    },

    governance: {
      governmentTransparency: mv(BASELINE_2007.governmentTransparency + leanMod * 2),
      budgetBalance: mv(BASELINE_2007.budgetBalance + leanMod * 0.8),
      debtToGdp: mv(Math.max(10, BASELINE_2007.debtToGdp - leanMod * 3)),
      corruptionIndex: mv(Math.max(15, BASELINE_2007.corruptionIndex - leanMod * 2)),
      voterTurnout: mv(BASELINE_2007.voterTurnout + leanMod),
      publicTrust: mv(BASELINE_2007.publicTrust + leanMod * 2),
      coDeterminationQuality: mv(BASELINE_2007.coDeterminationQuality + leanMod),
    },

    population: {
      populationGrowth: mv(popGrowth),
      urbanizationRate: mv(urban),
      medianAge: mv(medAge),
      migrationRate: mv(popGrowth - 0.3),
    },

    mediaInformation: {
      mediaPolarization: mv(Math.min(75, BASELINE_2007.mediaPolarization + Math.abs(leanMod) * 2)),
      disinformationRisk: mv(Math.min(70, BASELINE_2007.disinformationRisk + Math.abs(leanMod))),
      pressFreedom: mv(BASELINE_2007.pressFreedom + leanMod),
      socialMediaSentiment: mv(BASELINE_2007.socialMediaSentiment + leanMod * 2),
      newsTrust: mv(BASELINE_2007.newsTrust + leanMod),
    },

    lastUpdated: new Date(0),
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const stateMetrics2007: StateMetrics[] = states2007
  .filter((s) => s.countryId === "US")
  .map((s) => build2007Metrics(s._id));
