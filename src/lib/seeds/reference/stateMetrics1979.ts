/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1979 directly.
 * Type-only imports and same-era imports (states1979) are allowed.
 *
 * SCALE NOTE: 1979 is a *stagflation, energy-crisis, peak-industrial,
 * pre-Reagan* world. Era anchors that sit far from 2019/2023:
 *   - median household income national ≈ $16,461 (≈20% of the 2023 ≈$80,610)
 *   - home broadband 0% (the PC, let alone the internet, has not shipped)
 *   - federal budget in DEFICIT (FY1979 ≈ −1.6% of GDP) but gross federal debt
 *     only ≈ 33% of GDP — far below every later era (the pre-Reagan-deficits low)
 *   - incarceration ≈ 138/100k — the pre-mass-incarceration low (vs ~470 in 1999)
 *   - income inequality LOW (Gini ≈ 0.40) — before the post-1980 divergence
 *   - violent crime ≈ 549/100k and property crime near its all-time peak
 *   - renewable electricity ≈ 12% (essentially all hydro); carbon ≈ 21 t/capita
 *   - per-pupil school spending ≈ $2,200 nominal; HS-grad ≈ 71%
 *   - institutional trust LOW (the post-Watergate / "malaise" trough), but media
 *     polarization LOW (the three-network era)
 *   - manufacturing at its modern PEAK share; labor-force participation ≈ 63.7%
 * `metricScoring.THRESHOLDS`/`medianIncomeThreshold` are 2019-nominal and only
 * era-scale for the "1991" prefix, so these era-true values MIS-SCORE until a
 * 1979 band is added (deferred scoring-rebalance flag — seeds first).
 *
 * Per-state series are anchored to the 1979 national aggregates and the
 * (highly persistent) real relative state structure, with documented late-1970s
 * corrections: the energy-boom states (TX/OK/WY/AK/LA/WV/ND/MT) ride high, the
 * industrial Midwest (MI/OH/IN/IL) is still prosperous pre-deindustrialization,
 * and the Sun Belt (FL/AZ/GA/SC/NC) sits poorer relative to its later position.
 */
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { states1979 } from "./states1979";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

function mv(value: number, trend?: number): StateMetricValue {
  return trend !== undefined ? { value, trend } : { value };
}

// ── Real 1979 per-state series ───────────────────────────────────────────────

/** BLS 1979 annual-average unemployment (%). National 5.8% (stagflation; the
 *  industrial Midwest softening into the 1980 recession, energy states tight). */
const UNEMP_1979: Record<string, number> = {
  AL: 7.5,
  AK: 9.5,
  AZ: 5.3,
  AR: 6.5,
  CA: 6.2,
  CO: 4.6,
  CT: 5.0,
  DE: 7.5,
  DC: 7.3,
  FL: 6.0,
  GA: 5.4,
  HI: 6.4,
  ID: 5.0,
  IL: 5.5,
  IN: 6.0,
  IA: 4.0,
  KS: 3.4,
  KY: 5.6,
  LA: 6.7,
  ME: 7.2,
  MD: 6.0,
  MA: 5.5,
  MI: 7.8,
  MN: 4.2,
  MS: 6.4,
  MO: 4.5,
  MT: 5.0,
  NE: 3.0,
  NV: 5.0,
  NH: 3.1,
  NJ: 5.7,
  NM: 6.6,
  NY: 7.1,
  NC: 4.8,
  ND: 4.7,
  OH: 5.9,
  OK: 3.4,
  OR: 6.8,
  PA: 6.9,
  RI: 6.6,
  SC: 5.0,
  SD: 3.4,
  TN: 5.8,
  TX: 4.2,
  UT: 4.3,
  VT: 5.0,
  VA: 4.7,
  WA: 6.8,
  WV: 6.7,
  WI: 4.5,
  WY: 2.8,
};

/** Census 1979 median household income (USD). National ≈ $16,461. */
const MEDIAN_INCOME_1979: Record<string, number> = {
  AL: 14400,
  AK: 28000,
  AZ: 15600,
  AR: 12100,
  CA: 18800,
  CO: 17800,
  CT: 20500,
  DE: 19100,
  DC: 16500,
  FL: 14600,
  GA: 15300,
  HI: 20100,
  ID: 15600,
  IL: 19500,
  IN: 17800,
  IA: 16800,
  KS: 16400,
  KY: 14000,
  LA: 15500,
  ME: 13900,
  MD: 21300,
  MA: 18500,
  MI: 19800,
  MN: 18200,
  MS: 11800,
  MO: 16200,
  MT: 15000,
  NE: 16200,
  NV: 19000,
  NH: 17000,
  NJ: 21500,
  NM: 13200,
  NY: 18500,
  NC: 14300,
  ND: 15500,
  OH: 18500,
  OK: 16000,
  OR: 16800,
  PA: 17800,
  RI: 16500,
  SC: 14000,
  SD: 14800,
  TN: 13900,
  TX: 17500,
  UT: 16500,
  VT: 14500,
  VA: 16500,
  WA: 18800,
  WV: 14500,
  WI: 18000,
  WY: 19500,
};

/** Census 1979 poverty rate (%). National ≈ 11.7%. */
const POVERTY_1979: Record<string, number> = {
  AL: 18.9,
  AK: 9.5,
  AZ: 13.2,
  AR: 19.0,
  CA: 11.4,
  CO: 10.1,
  CT: 8.0,
  DE: 11.8,
  DC: 18.6,
  FL: 13.5,
  GA: 16.6,
  HI: 9.9,
  ID: 12.0,
  IL: 11.0,
  IN: 9.7,
  IA: 10.1,
  KS: 10.1,
  KY: 17.6,
  LA: 18.6,
  ME: 13.0,
  MD: 9.8,
  MA: 9.6,
  MI: 10.4,
  MN: 9.5,
  MS: 23.9,
  MO: 12.2,
  MT: 12.3,
  NE: 10.7,
  NV: 8.7,
  NH: 8.5,
  NJ: 9.5,
  NM: 17.6,
  NY: 13.4,
  NC: 14.8,
  ND: 12.6,
  OH: 10.3,
  OK: 13.4,
  OR: 10.7,
  PA: 10.5,
  RI: 10.3,
  SC: 16.6,
  SD: 16.9,
  TN: 16.5,
  TX: 14.7,
  UT: 10.3,
  VT: 12.1,
  VA: 11.8,
  WA: 9.8,
  WV: 15.0,
  WI: 8.7,
  WY: 7.9,
};

/** BEA 1979 real state GDP growth (%). National ≈ +3.2% (slowing into the 1980
 *  recession; auto states weak, energy states booming). */
const GDP_GROWTH_1979: Record<string, number> = {
  AL: 3.0,
  AK: 6.0,
  AZ: 5.0,
  AR: 3.0,
  CA: 4.0,
  CO: 5.0,
  CT: 3.5,
  DE: 3.0,
  DC: 2.5,
  FL: 5.0,
  GA: 4.0,
  HI: 3.5,
  ID: 3.5,
  IL: 2.5,
  IN: 2.0,
  IA: 3.0,
  KS: 4.0,
  KY: 2.8,
  LA: 5.5,
  ME: 3.0,
  MD: 3.5,
  MA: 4.0,
  MI: 0.5,
  MN: 3.5,
  MS: 3.0,
  MO: 2.5,
  MT: 4.0,
  NE: 3.5,
  NV: 5.5,
  NH: 4.5,
  NJ: 3.0,
  NM: 5.5,
  NY: 2.5,
  NC: 4.0,
  ND: 5.0,
  OH: 1.5,
  OK: 6.0,
  OR: 3.0,
  PA: 2.5,
  RI: 3.0,
  SC: 4.0,
  SD: 3.5,
  TN: 3.5,
  TX: 6.5,
  UT: 5.0,
  VT: 3.5,
  VA: 4.0,
  WA: 4.0,
  WV: 4.5,
  WI: 3.0,
  WY: 7.0,
};

/** 1979 life expectancy at birth (years). National ≈ 73.9. */
const LIFE_EXPECTANCY_1979: Record<string, number> = {
  AL: 71.5,
  AK: 73.0,
  AZ: 74.5,
  AR: 72.5,
  CA: 74.5,
  CO: 75.0,
  CT: 75.0,
  DE: 73.0,
  DC: 69.5,
  FL: 74.5,
  GA: 71.5,
  HI: 77.0,
  ID: 75.0,
  IL: 73.0,
  IN: 73.3,
  IA: 75.5,
  KS: 75.0,
  KY: 72.3,
  LA: 71.0,
  ME: 74.0,
  MD: 72.5,
  MA: 74.5,
  MI: 73.3,
  MN: 76.0,
  MS: 70.5,
  MO: 73.3,
  MT: 74.0,
  NE: 75.5,
  NV: 72.0,
  NH: 74.8,
  NJ: 73.5,
  NM: 73.5,
  NY: 73.5,
  NC: 72.3,
  ND: 76.0,
  OH: 73.3,
  OK: 73.0,
  OR: 75.0,
  PA: 73.0,
  RI: 74.5,
  SC: 71.0,
  SD: 75.0,
  TN: 72.0,
  TX: 73.0,
  UT: 75.5,
  VT: 74.5,
  VA: 72.8,
  WA: 75.0,
  WV: 72.0,
  WI: 75.0,
  WY: 74.0,
};

/** 1979 cost-of-living index (relative). National = 100. */
const COST_OF_LIVING_1979: Record<string, number> = {
  AL: 92,
  AK: 135,
  AZ: 100,
  AR: 90,
  CA: 112,
  CO: 102,
  CT: 112,
  DE: 102,
  DC: 120,
  FL: 100,
  GA: 95,
  HI: 150,
  ID: 97,
  IL: 104,
  IN: 96,
  IA: 96,
  KS: 94,
  KY: 93,
  LA: 96,
  ME: 105,
  MD: 108,
  MA: 112,
  MI: 103,
  MN: 102,
  MS: 90,
  MO: 95,
  MT: 99,
  NE: 95,
  NV: 108,
  NH: 108,
  NJ: 112,
  NM: 98,
  NY: 118,
  NC: 95,
  ND: 98,
  OH: 100,
  OK: 95,
  OR: 102,
  PA: 102,
  RI: 108,
  SC: 94,
  SD: 96,
  TN: 92,
  TX: 98,
  UT: 98,
  VT: 105,
  VA: 100,
  WA: 104,
  WV: 96,
  WI: 100,
  WY: 102,
};

/** 1979 population growth (% annual). National ≈ +1.1% — Sun-Belt boom,
 *  frostbelt stagnation (NY/OH/IL/PA flat or shrinking). */
const POP_GROWTH_1979: Record<string, number> = {
  AL: 1.3,
  AK: 3.5,
  AZ: 4.5,
  AR: 1.6,
  CA: 1.8,
  CO: 2.8,
  CT: 0.0,
  DE: 1.0,
  DC: -1.5,
  FL: 4.0,
  GA: 2.2,
  HI: 2.0,
  ID: 3.0,
  IL: 0.0,
  IN: 0.5,
  IA: 0.3,
  KS: 0.8,
  KY: 1.3,
  LA: 1.7,
  ME: 1.0,
  MD: 0.7,
  MA: -0.2,
  MI: 0.3,
  MN: 0.8,
  MS: 1.3,
  MO: 0.6,
  MT: 1.6,
  NE: 0.6,
  NV: 5.0,
  NH: 2.2,
  NJ: 0.0,
  NM: 2.8,
  NY: -0.7,
  NC: 1.6,
  ND: 0.8,
  OH: 0.0,
  OK: 1.8,
  OR: 2.2,
  PA: 0.0,
  RI: 0.2,
  SC: 1.8,
  SD: 0.5,
  TN: 1.7,
  TX: 2.7,
  UT: 2.8,
  VT: 1.3,
  VA: 1.5,
  WA: 2.2,
  WV: 1.1,
  WI: 0.6,
  WY: 4.0,
};

/** Urbanization (% urban; 1980 decennial). National ≈ 73.7%. */
const URBANIZATION_1979: Record<string, number> = {
  AL: 60,
  AK: 64,
  AZ: 84,
  AR: 52,
  CA: 91,
  CO: 81,
  CT: 79,
  DE: 71,
  DC: 100,
  FL: 84,
  GA: 62,
  HI: 87,
  ID: 54,
  IL: 83,
  IN: 64,
  IA: 59,
  KS: 67,
  KY: 51,
  LA: 69,
  ME: 48,
  MD: 80,
  MA: 84,
  MI: 71,
  MN: 67,
  MS: 47,
  MO: 68,
  MT: 53,
  NE: 63,
  NV: 85,
  NH: 52,
  NJ: 89,
  NM: 72,
  NY: 84,
  NC: 48,
  ND: 49,
  OH: 73,
  OK: 67,
  OR: 68,
  PA: 70,
  RI: 87,
  SC: 54,
  SD: 46,
  TN: 60,
  TX: 80,
  UT: 84,
  VT: 34,
  VA: 66,
  WA: 74,
  WV: 36,
  WI: 64,
  WY: 63,
};

/** Median age by state (1980 Census). National ≈ 30.0 (baby boomers in their 20s). */
const MEDIAN_AGE_1979: Record<string, number> = {
  AL: 29.3,
  AK: 26.1,
  AZ: 29.2,
  AR: 30.6,
  CA: 29.9,
  CO: 28.6,
  CT: 32.0,
  DE: 29.7,
  DC: 31.0,
  FL: 34.7,
  GA: 28.7,
  HI: 28.4,
  ID: 27.6,
  IL: 29.9,
  IN: 29.2,
  IA: 30.0,
  KS: 30.1,
  KY: 29.1,
  LA: 27.4,
  ME: 30.4,
  MD: 29.8,
  MA: 31.2,
  MI: 28.8,
  MN: 29.2,
  MS: 27.7,
  MO: 30.9,
  MT: 29.0,
  NE: 29.7,
  NV: 30.2,
  NH: 30.1,
  NJ: 32.2,
  NM: 27.4,
  NY: 31.9,
  NC: 29.6,
  ND: 28.3,
  OH: 29.9,
  OK: 30.1,
  OR: 30.2,
  PA: 32.1,
  RI: 31.8,
  SC: 28.0,
  SD: 28.9,
  TN: 30.1,
  TX: 28.2,
  UT: 24.2,
  VT: 29.4,
  VA: 29.8,
  WA: 30.2,
  WV: 30.4,
  WI: 29.4,
  WY: 27.1,
};

// ── 1979 soft-index national baselines (documented 1979 estimates) ───────────
const BASELINE_1979 = {
  // Media — the three-network, pre-cable era: low polarization, but trust in a
  // post-Watergate / "malaise" trough.
  mediaPolarization: 28,
  disinformationRisk: 12,
  pressFreedom: 78, // post-Watergate adversarial press
  newsTrust: 50,
  socialMediaSentiment: 0,

  // Public Safety — property crime near its all-time peak; pre-mass-incarceration.
  crimeRate: 5300, // FBI UCR 1979–80 property crime per 100k (near peak)
  violentCrimeRate: 549, // FBI UCR 1979 violent crime per 100k
  policePerCapita: 2.2,
  incarcerationRate: 138, // 1979 — the pre-mass-incarceration low
  recidivismRate: 50,
  publicSafetyConfidence: 48,

  // Governance — small-debt, post-Watergate-reform, low-trust era.
  governmentTransparency: 50,
  budgetBalance: -1.6, // FY1979 federal deficit ≈ −1.6% of GDP
  debtToGdp: 33, // gross federal debt/GDP ≈ 33% — the pre-Reagan-deficits low
  corruptionIndex: 30,
  voterTurnout: 52, // 1976/1980 presidential turnout ≈ 52–53%
  publicTrust: 30, // 1979 "crisis of confidence" trough
  coDeterminationQuality: 50, // union density at its ~24% peak

  // Education — 1979 scale far below every later era.
  highSchoolGradRate: 71,
  universityEnrollment: 40,
  testPerformance: 92,
  educationSpending: 2200, // NCES 1978-79 per-pupil ≈ $2,200 nominal
  literacyRate: 80,
  workforceSkill: 50,
  apprenticeshipRate: 2.5, // strong union apprenticeship pipeline

  // Environment — pre-cleanup grid; minimal recycling; hydro-only renewables.
  airQuality: 22,
  renewableEnergy: 12, // ≈12% of electricity, essentially all hydro
  carbonEmissions: 21, // ≈21 t/capita
  recyclingRate: 7,
  climateResilience: 50,
  protectedLand: 9,
  energyTransitionProgress: 4,

  // Social — high mobility, LOW inequality (pre-1980 divergence), strong cohesion.
  socialMobility: 60,
  incomeInequality: 35, // Gini 1979 ≈ 0.40
  homelessnessRate: 5,
  foodInsecurity: 11,
  civicParticipation: 56,
  socialCohesion: 58,
  housingSupplyGrowth: 1.8, // strong construction, but high mortgage rates biting

  // Healthcare — pre-managed-care, pre-ACA.
  uninsuredRate: 13.0,
  affordabilityIndex: 52,
  physicianRate: 1.9, // ≈1.9 physicians/1000 in 1979
  preventableMortality: 420,
  publicHealthPreparedness: 50,
};

function econTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_1979[stateId] ?? 16461;
  if (income >= 19500) return 5;
  if (income >= 17500) return 4;
  if (income >= 15500) return 3;
  if (income >= 13800) return 2;
  return 1;
}
// 1979 has no broadband, so the education tier keys off income (the era's best
// available proxy for school resourcing / attainment).
function eduTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_1979[stateId] ?? 16461;
  if (income >= 19500) return 5;
  if (income >= 17800) return 4;
  if (income >= 16000) return 3;
  if (income >= 14000) return 2;
  return 1;
}

function build1979Metrics(stateId: string): StateMetrics {
  const et = econTier(stateId) - 1;
  const ed = eduTier(stateId) - 1;
  const urban = URBANIZATION_1979[stateId] ?? 73.7;
  const popGrowth = POP_GROWTH_1979[stateId] ?? 1.1;
  const medAge = MEDIAN_AGE_1979[stateId] ?? 30.0;
  const unemp = UNEMP_1979[stateId] ?? 5.8;
  const income = MEDIAN_INCOME_1979[stateId] ?? 16461;
  const poverty = POVERTY_1979[stateId] ?? 11.7;
  const gdpGrowth = GDP_GROWTH_1979[stateId] ?? 3.2;
  const lifeExp = LIFE_EXPECTANCY_1979[stateId] ?? 73.9;
  const col = COST_OF_LIVING_1979[stateId] ?? 100;

  const leanMod = (et - 2) * 2;
  // 1979 infra band keyed off income (no broadband this era).
  const infra = Math.max(0, Math.min(4, et));

  return withUniformMetricSet({
    _id: stateId,
    countryId: "US",

    economic: {
      unemploymentRate: mv(unemp),
      medianIncome: mv(income),
      gdpGrowth: mv(gdpGrowth),
      povertyRate: mv(poverty),
      costOfLiving: mv(col),
      smallBusinessFormation: mv([2.5, 3.0, 3.5, 4.0, 5.0][et]), // pre-1980s; high-rate environment dampens formation
      laborParticipation: mv(63.7), // 1979 LFPR ≈ 63.7%
      matchingFriction: mv(5),
      tradeBalance: mv(0),
      productivityGrowth: mv(Math.round(gdpGrowth * 0.4 * 10) / 10), // the 1970s productivity slowdown
      rdIntensity: mv(0.9 + ed * 0.2),
      exportDependency: mv(18), // pre-globalization, lower trade share
      manufacturingCompetitiveness: mv(Math.max(55, Math.min(98, [70, 78, 85, 92, 98][ed]))), // peak-industrial era
    },

    education: {
      highSchoolGradRate: mv(BASELINE_1979.highSchoolGradRate + leanMod * 0.6),
      universityEnrollment: mv(BASELINE_1979.universityEnrollment + leanMod),
      testPerformance: mv(BASELINE_1979.testPerformance + leanMod * 1.5),
      educationSpending: mv(BASELINE_1979.educationSpending + leanMod * 120),
      literacyRate: mv(BASELINE_1979.literacyRate + leanMod * 0.5),
      workforceSkill: mv(BASELINE_1979.workforceSkill + leanMod * 2),
      apprenticeshipRate: mv(BASELINE_1979.apprenticeshipRate),
    },

    healthcare: {
      uninsuredRate: mv(Math.max(4, BASELINE_1979.uninsuredRate - leanMod * 1.0)),
      affordabilityIndex: mv(BASELINE_1979.affordabilityIndex + leanMod * 2),
      physicianRate: mv(BASELINE_1979.physicianRate + leanMod * 0.06),
      lifeExpectancy: mv(lifeExp),
      preventableMortality: mv(BASELINE_1979.preventableMortality - leanMod * 15),
      publicHealthPreparedness: mv(BASELINE_1979.publicHealthPreparedness + leanMod * 2),
    },

    infrastructure: {
      roadCondition: mv([52, 62, 71, 80, 88][infra]),
      broadbandAccess: mv(0), // no broadband in 1979
      publicTransit: mv(Math.round(urban * 0.45 + infra * 4)),
      waterQuality: mv([72, 80, 86, 91, 95][infra]),
      powerGridReliability: mv([98.6, 99.0, 99.4, 99.65, 99.85][infra]),
      infrastructureInvestmentGap: mv([46, 38, 30, 22, 14][infra]),
    },

    publicSafety: {
      crimeRate: mv(BASELINE_1979.crimeRate + (urban - 73.7) * 8 - leanMod * 50),
      violentCrimeRate: mv(BASELINE_1979.violentCrimeRate + (urban - 73.7) * 2 - leanMod * 14),
      policePerCapita: mv(BASELINE_1979.policePerCapita + urban * 0.005),
      incarcerationRate: mv(Math.max(60, BASELINE_1979.incarcerationRate - leanMod * 6)),
      recidivismRate: mv(BASELINE_1979.recidivismRate - leanMod * 2),
      publicSafetyConfidence: mv(BASELINE_1979.publicSafetyConfidence + leanMod * 2),
    },

    environment: {
      airQuality: mv(Math.max(8, BASELINE_1979.airQuality - leanMod * 2 + urban * 0.05)),
      renewableEnergy: mv(Math.max(1, BASELINE_1979.renewableEnergy + leanMod * 1.0)),
      carbonEmissions: mv(BASELINE_1979.carbonEmissions - leanMod * 0.6),
      recyclingRate: mv(Math.max(2, BASELINE_1979.recyclingRate + leanMod * 1.0)),
      climateResilience: mv(BASELINE_1979.climateResilience + leanMod * 2),
      protectedLand: mv(BASELINE_1979.protectedLand + (100 - urban) * 0.08),
      energyTransitionProgress: mv(Math.max(1, BASELINE_1979.energyTransitionProgress + leanMod)),
    },

    social: {
      socialMobility: mv(BASELINE_1979.socialMobility + leanMod * 3),
      incomeInequality: mv(
        Math.max(25, Math.min(52, BASELINE_1979.incomeInequality - leanMod * 2))
      ),
      homelessnessRate: mv(
        Math.max(1, BASELINE_1979.homelessnessRate + (col - 100) * 0.04 + urban * 0.03)
      ),
      foodInsecurity: mv(Math.max(5, BASELINE_1979.foodInsecurity - leanMod * 0.8)),
      civicParticipation: mv(BASELINE_1979.civicParticipation + leanMod * 2),
      socialCohesion: mv(Math.max(25, BASELINE_1979.socialCohesion + leanMod * 2 - urban * 0.04)),
      housingSupplyGrowth: mv(BASELINE_1979.housingSupplyGrowth + popGrowth * 0.3),
    },

    governance: {
      governmentTransparency: mv(BASELINE_1979.governmentTransparency + leanMod * 2),
      budgetBalance: mv(BASELINE_1979.budgetBalance + leanMod * 0.5),
      debtToGdp: mv(Math.max(10, BASELINE_1979.debtToGdp - leanMod * 2)),
      corruptionIndex: mv(Math.max(15, BASELINE_1979.corruptionIndex - leanMod * 2)),
      voterTurnout: mv(BASELINE_1979.voterTurnout + leanMod),
      publicTrust: mv(BASELINE_1979.publicTrust + leanMod * 2),
      coDeterminationQuality: mv(BASELINE_1979.coDeterminationQuality + leanMod),
    },

    population: {
      populationGrowth: mv(popGrowth),
      urbanizationRate: mv(urban),
      medianAge: mv(medAge),
      migrationRate: mv(popGrowth - 0.3),
    },

    mediaInformation: {
      mediaPolarization: mv(Math.min(70, BASELINE_1979.mediaPolarization + Math.abs(leanMod) * 2)),
      disinformationRisk: mv(Math.min(60, BASELINE_1979.disinformationRisk + Math.abs(leanMod))),
      pressFreedom: mv(BASELINE_1979.pressFreedom + leanMod),
      socialMediaSentiment: mv(BASELINE_1979.socialMediaSentiment + leanMod * 2),
      newsTrust: mv(BASELINE_1979.newsTrust + leanMod),
    },

    lastUpdated: new Date(0),
  });
}

export const stateMetrics1979: StateMetrics[] = states1979
  .filter((s) => s.countryId === "US")
  .map((s) => build1979Metrics(s._id));
