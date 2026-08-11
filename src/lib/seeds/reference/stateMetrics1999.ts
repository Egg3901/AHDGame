/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1999 directly.
 * Type-only imports and same-era imports (states1999) are allowed.
 *
 * SCALE NOTE: 1999 is a *dot-com-boom, budget-surplus, pre-broadband* world.
 * Era anchors that sit far from 2019/2023:
 *   - median household income national ≈ $40,816 (≈51% of the 2023 ≈$80,610)
 *   - home broadband ≈ 1–3% of households (DIAL-UP era; broadband barely shipped)
 *   - federal budget in SURPLUS (FY1999 ≈ +1.4% of GDP)
 *   - uninsured ≈ 14%, life expectancy ≈ 76.7, HS-grad (AFGR) ≈ 71%
 *   - renewable electricity ≈ 9% (mostly hydro); carbon ≈ 20 t/capita
 *   - violent crime ≈ 523/100k (still elevated, falling from the early-90s peak)
 *   - institutional trust HIGHER and media polarization LOWER than the 2000s+
 * `metricScoring.THRESHOLDS`/`medianIncomeThreshold` are 2019-nominal and only
 * era-scale for the "1991" prefix, so these era-true values MIS-SCORE until a
 * 1999 band is added (deferred scoring-rebalance flag — seeds first).
 */
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { states1999 } from "./states1999";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

function mv(value: number, trend?: number): StateMetricValue {
  return trend !== undefined ? { value, trend } : { value };
}

// ── Real 1999 per-state series ───────────────────────────────────────────────

/** BLS 1999 annual-average unemployment (%). National 4.2% (dot-com-boom trough). */
const UNEMP_1999: Record<string, number> = {
  AL: 4.8,
  AK: 6.4,
  AZ: 4.0,
  AR: 4.5,
  CA: 5.2,
  CO: 2.9,
  CT: 3.2,
  DE: 3.5,
  DC: 6.3,
  FL: 3.9,
  GA: 4.0,
  HI: 5.6,
  ID: 5.2,
  IL: 4.3,
  IN: 3.0,
  IA: 2.5,
  KS: 3.0,
  KY: 4.5,
  LA: 5.1,
  ME: 4.0,
  MD: 3.5,
  MA: 3.2,
  MI: 3.8,
  MN: 2.8,
  MS: 5.1,
  MO: 3.4,
  MT: 5.2,
  NE: 2.9,
  NV: 4.4,
  NH: 2.7,
  NJ: 4.6,
  NM: 5.6,
  NY: 5.0,
  NC: 3.0,
  ND: 3.4,
  OH: 4.3,
  OK: 3.4,
  OR: 5.7,
  PA: 4.4,
  RI: 4.1,
  SC: 4.5,
  SD: 2.9,
  TN: 4.0,
  TX: 4.6,
  UT: 3.7,
  VT: 2.9,
  VA: 2.8,
  WA: 4.7,
  WV: 6.6,
  WI: 3.0,
  WY: 4.9,
};

/** Census 1999 median household income (USD). National ≈ $40,816. */
const MEDIAN_INCOME_1999: Record<string, number> = {
  AL: 36213,
  AK: 51046,
  AZ: 38653,
  AR: 29762,
  CA: 43744,
  CO: 48506,
  CT: 50798,
  DE: 47381,
  DC: 39435,
  FL: 38819,
  GA: 42433,
  HI: 49820,
  ID: 38613,
  IL: 46392,
  IN: 42168,
  IA: 40927,
  KS: 40624,
  KY: 36826,
  LA: 33312,
  ME: 37654,
  MD: 52868,
  MA: 50587,
  MI: 46238,
  MN: 48536,
  MS: 31963,
  MO: 43955,
  MT: 33900,
  NE: 39250,
  NV: 46289,
  NH: 49467,
  NJ: 53266,
  NM: 34133,
  NY: 43393,
  NC: 39184,
  ND: 34604,
  OH: 41972,
  OK: 33874,
  OR: 42568,
  PA: 43577,
  RI: 43331,
  SC: 37119,
  SD: 35962,
  TN: 36360,
  TX: 39927,
  UT: 47934,
  VT: 41929,
  VA: 46677,
  WA: 45776,
  WV: 29696,
  WI: 45441,
  WY: 37892,
};

/** Census 1999 poverty rate (%). National ≈ 11.9%. */
const POVERTY_1999: Record<string, number> = {
  AL: 14.5,
  AK: 7.6,
  AZ: 13.9,
  AR: 14.7,
  CA: 14.0,
  CO: 8.5,
  CT: 7.7,
  DE: 8.4,
  DC: 16.7,
  FL: 12.0,
  GA: 12.5,
  HI: 10.6,
  ID: 11.8,
  IL: 10.7,
  IN: 8.3,
  IA: 9.1,
  KS: 9.6,
  KY: 12.5,
  LA: 18.5,
  ME: 9.8,
  MD: 7.3,
  MA: 9.3,
  MI: 10.2,
  MN: 6.9,
  MS: 17.6,
  MO: 9.6,
  MT: 14.6,
  NE: 9.7,
  NV: 10.5,
  NH: 6.5,
  NJ: 7.6,
  NM: 18.0,
  NY: 14.0,
  NC: 12.3,
  ND: 11.9,
  OH: 10.6,
  OK: 14.1,
  OR: 11.6,
  PA: 9.8,
  RI: 10.2,
  SC: 12.0,
  SD: 11.1,
  TN: 13.3,
  TX: 14.9,
  UT: 8.0,
  VT: 9.4,
  VA: 9.6,
  WA: 9.5,
  WV: 16.0,
  WI: 8.7,
  WY: 11.1,
};

/** BEA 1999 real state GDP growth (%). National ≈ +4.8% (boom). */
const GDP_GROWTH_1999: Record<string, number> = {
  AL: 3.4,
  AK: 1.2,
  AZ: 6.8,
  AR: 3.0,
  CA: 6.5,
  CO: 6.9,
  CT: 4.0,
  DE: 4.5,
  DC: 3.6,
  FL: 5.4,
  GA: 5.8,
  HI: 2.4,
  ID: 4.6,
  IL: 4.2,
  IN: 3.8,
  IA: 3.5,
  KS: 3.6,
  KY: 3.4,
  LA: 2.2,
  ME: 4.0,
  MD: 4.3,
  MA: 5.6,
  MI: 3.6,
  MN: 5.2,
  MS: 3.0,
  MO: 4.0,
  MT: 2.6,
  NE: 3.4,
  NV: 6.7,
  NH: 5.9,
  NJ: 4.3,
  NM: 3.5,
  NY: 4.8,
  NC: 5.6,
  ND: 1.8,
  OH: 3.6,
  OK: 2.8,
  OR: 7.1,
  PA: 3.9,
  RI: 4.0,
  SC: 4.6,
  SD: 3.9,
  TN: 4.4,
  TX: 6.1,
  UT: 5.6,
  VT: 4.0,
  VA: 5.5,
  WA: 6.4,
  WV: 2.2,
  WI: 4.4,
  WY: 1.8,
};

/** 1999 life expectancy at birth (years). National ≈ 76.7. */
const LIFE_EXPECTANCY_1999: Record<string, number> = {
  AL: 74.0,
  AK: 77.5,
  AZ: 77.5,
  AR: 74.8,
  CA: 78.0,
  CO: 78.2,
  CT: 78.5,
  DE: 76.4,
  DC: 72.5,
  FL: 77.8,
  GA: 74.9,
  HI: 80.5,
  ID: 78.0,
  IL: 76.5,
  IN: 75.8,
  IA: 78.5,
  KS: 77.6,
  KY: 74.5,
  LA: 73.8,
  ME: 77.3,
  MD: 75.9,
  MA: 78.2,
  MI: 75.8,
  MN: 79.3,
  MS: 72.9,
  MO: 75.7,
  MT: 77.4,
  NE: 78.5,
  NV: 75.4,
  NH: 78.3,
  NJ: 77.0,
  NM: 77.0,
  NY: 77.4,
  NC: 75.2,
  ND: 79.0,
  OH: 75.8,
  OK: 74.6,
  OR: 78.0,
  PA: 76.3,
  RI: 78.0,
  SC: 73.9,
  SD: 78.1,
  TN: 74.3,
  TX: 76.4,
  UT: 78.7,
  VT: 78.4,
  VA: 76.0,
  WA: 78.5,
  WV: 74.5,
  WI: 78.4,
  WY: 77.2,
};

/** 1999 home broadband subscription (% of households). National ≈ 1–2% — the
 *  defining 1999 anchor: residential broadband was barely rolling out (DSL/cable
 *  pilots in metros; everyone else on dial-up). Source: NTIA "Falling Through the
 *  Net" 1999 / FCC early Form 477. */
const BROADBAND_1999: Record<string, number> = {
  AL: 0.5,
  AK: 1.5,
  AZ: 1.5,
  AR: 0.4,
  CA: 3.0,
  CO: 2.5,
  CT: 2.5,
  DE: 1.5,
  DC: 3.0,
  FL: 1.5,
  GA: 1.2,
  HI: 1.5,
  ID: 1.0,
  IL: 1.8,
  IN: 1.0,
  IA: 0.8,
  KS: 1.0,
  KY: 0.6,
  LA: 0.5,
  ME: 1.0,
  MD: 2.5,
  MA: 3.0,
  MI: 1.2,
  MN: 2.0,
  MS: 0.3,
  MO: 1.0,
  MT: 0.6,
  NE: 1.0,
  NV: 1.8,
  NH: 2.0,
  NJ: 2.8,
  NM: 0.8,
  NY: 2.5,
  NC: 1.0,
  ND: 0.6,
  OH: 1.2,
  OK: 0.7,
  OR: 2.2,
  PA: 1.5,
  RI: 2.0,
  SC: 0.8,
  SD: 0.6,
  TN: 0.9,
  TX: 1.5,
  UT: 2.0,
  VT: 1.2,
  VA: 2.2,
  WA: 2.8,
  WV: 0.4,
  WI: 1.2,
  WY: 0.6,
};

/** 1999 cost-of-living index (ACCRA composite). National = 100. */
const COST_OF_LIVING_1999: Record<string, number> = {
  AL: 94,
  AK: 124,
  AZ: 100,
  AR: 90,
  CA: 130,
  CO: 102,
  CT: 120,
  DE: 102,
  DC: 135,
  FL: 102,
  GA: 96,
  HI: 165,
  ID: 97,
  IL: 101,
  IN: 94,
  IA: 93,
  KS: 92,
  KY: 92,
  LA: 96,
  ME: 110,
  MD: 116,
  MA: 124,
  MI: 99,
  MN: 102,
  MS: 91,
  MO: 92,
  MT: 100,
  NE: 92,
  NV: 106,
  NH: 115,
  NJ: 122,
  NM: 100,
  NY: 128,
  NC: 97,
  ND: 96,
  OH: 97,
  OK: 90,
  OR: 106,
  PA: 101,
  RI: 116,
  SC: 97,
  SD: 99,
  TN: 91,
  TX: 93,
  UT: 99,
  VT: 114,
  VA: 102,
  WA: 106,
  WV: 96,
  WI: 99,
  WY: 100,
};

/** 1999 population growth (% annual, 1998→1999 estimates). Sun-Belt boom. */
const POP_GROWTH_1999: Record<string, number> = {
  AL: 0.7,
  AK: 1.0,
  AZ: 3.3,
  AR: 0.9,
  CA: 1.5,
  CO: 2.6,
  CT: 0.3,
  DE: 1.4,
  DC: -1.0,
  FL: 2.0,
  GA: 2.4,
  HI: 0.4,
  ID: 1.9,
  IL: 0.6,
  IN: 0.7,
  IA: 0.4,
  KS: 0.6,
  KY: 0.7,
  LA: 0.5,
  ME: 0.4,
  MD: 0.8,
  MA: 0.5,
  MI: 0.5,
  MN: 1.0,
  MS: 0.7,
  MO: 0.8,
  MT: 0.6,
  NE: 0.6,
  NV: 4.5,
  NH: 1.1,
  NJ: 0.7,
  NM: 1.4,
  NY: 0.3,
  NC: 1.9,
  ND: -0.3,
  OH: 0.3,
  OK: 0.6,
  OR: 1.5,
  PA: 0.1,
  RI: 0.4,
  SC: 1.5,
  SD: 0.6,
  TN: 1.4,
  TX: 2.0,
  UT: 2.0,
  VT: 0.4,
  VA: 1.3,
  WA: 1.7,
  WV: 0.0,
  WI: 0.7,
  WY: 0.6,
};

/** Urbanization (% urban; 2000 decennial reference). National ≈ 79%. */
const URBANIZATION_1999: Record<string, number> = {
  AL: 55,
  AK: 65,
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

/** Median age by state (Census 1999 estimates). National ≈ 35.5. */
const MEDIAN_AGE_1999: Record<string, number> = {
  AL: 35.8,
  AK: 32.4,
  AZ: 34.2,
  AR: 35.7,
  CA: 33.3,
  CO: 34.6,
  CT: 37.4,
  DE: 36.0,
  DC: 34.6,
  FL: 38.7,
  GA: 33.9,
  HI: 36.5,
  ID: 33.2,
  IL: 34.7,
  IN: 35.2,
  IA: 36.6,
  KS: 35.2,
  KY: 35.9,
  LA: 34.0,
  ME: 38.6,
  MD: 36.0,
  MA: 36.5,
  MI: 35.5,
  MN: 35.4,
  MS: 33.8,
  MO: 36.1,
  MT: 37.5,
  NE: 35.3,
  NV: 35.0,
  NH: 37.1,
  NJ: 36.7,
  NM: 34.6,
  NY: 35.9,
  NC: 35.3,
  ND: 36.2,
  OH: 36.2,
  OK: 35.5,
  OR: 36.3,
  PA: 38.0,
  RI: 36.7,
  SC: 35.4,
  SD: 35.6,
  TN: 35.8,
  TX: 32.3,
  UT: 27.1,
  VT: 37.6,
  VA: 35.7,
  WA: 35.4,
  WV: 38.9,
  WI: 36.0,
  WY: 36.6,
};

// ── 1999 soft-index national baselines (documented 1999 estimates) ───────────
const BASELINE_1999 = {
  // Media — pre-Fox-dominance, pre-broadband; high trust, low polarization.
  mediaPolarization: 35,
  disinformationRisk: 18,
  pressFreedom: 76,
  newsTrust: 53, // Gallup 1999 media trust ~55% (vs ~32% in 2023)
  socialMediaSentiment: 0,

  // Public Safety — 1999 crime still elevated, falling from the early-90s peak.
  crimeRate: 3744, // FBI UCR 1999 property crime per 100k
  violentCrimeRate: 523, // FBI UCR 1999 violent crime per 100k
  policePerCapita: 2.3,
  incarcerationRate: 476, // 1999, rising toward the mid-2000s peak
  recidivismRate: 46,
  publicSafetyConfidence: 56,

  // Governance — the SURPLUS era.
  governmentTransparency: 56,
  budgetBalance: 1.4, // FY1999 federal surplus ≈ +1.4% GDP; state budgets flush
  debtToGdp: 58, // gross federal debt/GDP, declining
  corruptionIndex: 25, // TI CPI 1999 US ≈ 7.5/10
  voterTurnout: 46, // 1998 midterm ~38% / 2000 ~54% blend
  publicTrust: 40,
  coDeterminationQuality: 44,

  // Education — 1999 scale well below 2007/2019/2023.
  highSchoolGradRate: 71, // AFGR 1998-99
  universityEnrollment: 53,
  testPerformance: 96, // NAEP late-90s
  educationSpending: 6500, // NCES 1998-99 per-pupil ≈ $6,500 (vs ≈$14,600 in 2023)
  literacyRate: 78,
  workforceSkill: 56,
  apprenticeshipRate: 2.0,

  // Environment — pre-renewables; coal-heavy grid.
  airQuality: 26,
  renewableEnergy: 9, // EIA 1999 renewable electricity (mostly hydro)
  carbonEmissions: 20, // ≈20 t/capita in 1999
  recyclingRate: 24, // EPA late-90s MSW recycling
  climateResilience: 50,
  protectedLand: 11,
  energyTransitionProgress: 8,

  // Social — late-90s boom optimism, pre-9/11 cohesion.
  socialMobility: 58,
  incomeInequality: 42, // Gini 1999 ≈ 0.458
  homelessnessRate: 9,
  foodInsecurity: 10.1, // USDA 1999
  civicParticipation: 54,
  socialCohesion: 60,
  housingSupplyGrowth: 1.6, // strong late-90s construction

  // Healthcare — pre-ACA, pre-Part-D.
  uninsuredRate: 14.0, // Census 1999
  affordabilityIndex: 54,
  physicianRate: 2.4,
  preventableMortality: 380,
  publicHealthPreparedness: 56,
};

function econTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_1999[stateId] ?? 40816;
  if (income >= 49000) return 5;
  if (income >= 44000) return 4;
  if (income >= 39000) return 3;
  if (income >= 34000) return 2;
  return 1;
}
function eduTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const bb = BROADBAND_1999[stateId] ?? 1.2;
  if (bb >= 2.5) return 5;
  if (bb >= 1.8) return 4;
  if (bb >= 1.0) return 3;
  if (bb >= 0.6) return 2;
  return 1;
}

function build1999Metrics(stateId: string): StateMetrics {
  const et = econTier(stateId) - 1;
  const ed = eduTier(stateId) - 1;
  const urban = URBANIZATION_1999[stateId] ?? 79;
  const popGrowth = POP_GROWTH_1999[stateId] ?? 1.0;
  const medAge = MEDIAN_AGE_1999[stateId] ?? 35.5;
  const unemp = UNEMP_1999[stateId] ?? 4.2;
  const income = MEDIAN_INCOME_1999[stateId] ?? 40816;
  const poverty = POVERTY_1999[stateId] ?? 11.9;
  const gdpGrowth = GDP_GROWTH_1999[stateId] ?? 4.8;
  const lifeExp = LIFE_EXPECTANCY_1999[stateId] ?? 76.7;
  const broadband = BROADBAND_1999[stateId] ?? 1.2;
  const col = COST_OF_LIVING_1999[stateId] ?? 100;

  const leanMod = (et - 2) * 2;
  // 1999 infra band keyed off income (broadband is uniformly near-zero this era).
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
      smallBusinessFormation: mv([3.5, 4.5, 5.5, 6.5, 8.0][et]), // dot-com-era formation high
      laborParticipation: mv(67), // 1999 LFPR ≈ 67% (cyclical peak)
      matchingFriction: mv(4),
      tradeBalance: mv(0),
      productivityGrowth: mv(Math.round(gdpGrowth * 0.5 * 10) / 10),
      rdIntensity: mv(1.1 + ed * 0.2),
      exportDependency: mv(28),
      manufacturingCompetitiveness: mv(Math.max(45, Math.min(95, [55, 65, 72, 80, 90][ed]))), // manufacturing peak-share era
    },

    education: {
      highSchoolGradRate: mv(BASELINE_1999.highSchoolGradRate + leanMod * 0.6),
      universityEnrollment: mv(BASELINE_1999.universityEnrollment + leanMod),
      testPerformance: mv(BASELINE_1999.testPerformance + leanMod * 1.5),
      educationSpending: mv(BASELINE_1999.educationSpending + leanMod * 300),
      literacyRate: mv(BASELINE_1999.literacyRate + leanMod * 0.5),
      workforceSkill: mv(BASELINE_1999.workforceSkill + leanMod * 2),
      apprenticeshipRate: mv(BASELINE_1999.apprenticeshipRate),
    },

    healthcare: {
      uninsuredRate: mv(Math.max(4, BASELINE_1999.uninsuredRate - leanMod * 1.0)),
      affordabilityIndex: mv(BASELINE_1999.affordabilityIndex + leanMod * 2),
      physicianRate: mv(BASELINE_1999.physicianRate + leanMod * 0.07),
      lifeExpectancy: mv(lifeExp),
      preventableMortality: mv(BASELINE_1999.preventableMortality - leanMod * 15),
      publicHealthPreparedness: mv(BASELINE_1999.publicHealthPreparedness + leanMod * 2),
    },

    infrastructure: {
      roadCondition: mv([50, 60, 70, 79, 87][infra]),
      broadbandAccess: mv(broadband),
      publicTransit: mv(Math.round(urban * 0.45 + infra * 4)),
      waterQuality: mv([76, 83, 89, 94, 97][infra]),
      powerGridReliability: mv([98.8, 99.2, 99.5, 99.75, 99.9][infra]),
      infrastructureInvestmentGap: mv([44, 36, 28, 20, 12][infra]),
    },

    publicSafety: {
      crimeRate: mv(BASELINE_1999.crimeRate + (urban - 79) * 8 - leanMod * 50),
      violentCrimeRate: mv(BASELINE_1999.violentCrimeRate + (urban - 79) * 2 - leanMod * 14),
      policePerCapita: mv(BASELINE_1999.policePerCapita + urban * 0.005),
      incarcerationRate: mv(BASELINE_1999.incarcerationRate - leanMod * 15),
      recidivismRate: mv(BASELINE_1999.recidivismRate - leanMod * 2),
      publicSafetyConfidence: mv(BASELINE_1999.publicSafetyConfidence + leanMod * 2),
    },

    environment: {
      airQuality: mv(Math.max(8, BASELINE_1999.airQuality - leanMod * 2 + urban * 0.05)),
      renewableEnergy: mv(Math.max(1, BASELINE_1999.renewableEnergy + leanMod * 1.0)),
      carbonEmissions: mv(BASELINE_1999.carbonEmissions - leanMod * 0.6),
      recyclingRate: mv(Math.max(8, BASELINE_1999.recyclingRate + leanMod * 2)),
      climateResilience: mv(BASELINE_1999.climateResilience + leanMod * 2),
      protectedLand: mv(BASELINE_1999.protectedLand + (100 - urban) * 0.08),
      energyTransitionProgress: mv(Math.max(2, BASELINE_1999.energyTransitionProgress + leanMod)),
    },

    social: {
      socialMobility: mv(BASELINE_1999.socialMobility + leanMod * 3),
      incomeInequality: mv(
        Math.max(28, Math.min(58, BASELINE_1999.incomeInequality - leanMod * 2))
      ),
      homelessnessRate: mv(
        Math.max(1, BASELINE_1999.homelessnessRate + (col - 100) * 0.06 + urban * 0.04)
      ),
      foodInsecurity: mv(Math.max(5, BASELINE_1999.foodInsecurity - leanMod * 0.8)),
      civicParticipation: mv(BASELINE_1999.civicParticipation + leanMod * 2),
      socialCohesion: mv(Math.max(25, BASELINE_1999.socialCohesion + leanMod * 2 - urban * 0.04)),
      housingSupplyGrowth: mv(BASELINE_1999.housingSupplyGrowth + popGrowth * 0.3),
    },

    governance: {
      governmentTransparency: mv(BASELINE_1999.governmentTransparency + leanMod * 2),
      budgetBalance: mv(BASELINE_1999.budgetBalance + leanMod * 0.6),
      debtToGdp: mv(Math.max(10, BASELINE_1999.debtToGdp - leanMod * 3)),
      corruptionIndex: mv(Math.max(15, BASELINE_1999.corruptionIndex - leanMod * 2)),
      voterTurnout: mv(BASELINE_1999.voterTurnout + leanMod),
      publicTrust: mv(BASELINE_1999.publicTrust + leanMod * 2),
      coDeterminationQuality: mv(BASELINE_1999.coDeterminationQuality + leanMod),
    },

    population: {
      populationGrowth: mv(popGrowth),
      urbanizationRate: mv(urban),
      medianAge: mv(medAge),
      migrationRate: mv(popGrowth - 0.3),
    },

    mediaInformation: {
      mediaPolarization: mv(Math.min(70, BASELINE_1999.mediaPolarization + Math.abs(leanMod) * 2)),
      disinformationRisk: mv(Math.min(60, BASELINE_1999.disinformationRisk + Math.abs(leanMod))),
      pressFreedom: mv(BASELINE_1999.pressFreedom + leanMod),
      socialMediaSentiment: mv(BASELINE_1999.socialMediaSentiment + leanMod * 2),
      newsTrust: mv(BASELINE_1999.newsTrust + leanMod),
    },

    lastUpdated: new Date(0),
  });
}

export const stateMetrics1999: StateMetrics[] = states1999
  .filter((s) => s.countryId === "US")
  .map((s) => build1999Metrics(s._id));
