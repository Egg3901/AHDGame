/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1953 directly.
 * Type-only imports and same-era imports (states1953) are allowed.
 *
 * SCALE NOTE: 1953 is a *post-Korean-War, peak-manufacturing, pre-Civil-Rights,
 * Eisenhower year-one* world. Era anchors that sit far from all later eras:
 *   - median household income national ≈ $3,900 (≈5% of the 2023 ≈$80,610)
 *   - home broadband 0% (the commercial TV set is barely a decade old)
 *   - unemployment ≈ 2.9% — the peacetime low, post-Korean-War demobilization
 *   - incarceration ≈ 98/100k — the historical low, pre-mass-incarceration
 *   - income inequality VERY LOW (Gini ≈ 0.37) — peak New Deal redistribution era
 *   - violent crime LOW (~160/100k) — pre-baby-boom urban crime surge
 *   - manufacturing at its absolute PEAK share (~30% of GDP)
 *   - defense spending VERY HIGH (~14% of GDP; Korean War + NATO buildup)
 *   - agriculture still significant (~8% of GDP; farm population ~15%)
 *   - no broadband, no cable, no internet; three TV networks barely launched
 *   - racial segregation legal (pre-Brown v. Board); Jim Crow South
 *   - labor union density at its historic peak (~35% private-sector unionization)
 *   - life expectancy ≈ 68.8 years (antibiotics new; cardiac disease high)
 */
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { states1953 } from "./states1953";
import { withUniformMetricSet } from "@/lib/seeds/shared/uniformStateMetrics";

function mv(value: number, trend?: number): StateMetricValue {
  return trend !== undefined ? { value, trend } : { value };
}

// ── Real 1953 per-state series ───────────────────────────────────────────────

/** BLS 1953 annual-average unemployment (%). National ≈ 2.9%
 *  (post-Korean-War prosperity; manufacturing belt very tight). */
const UNEMP_1953: Record<string, number> = {
  AL: 3.8,
  AK: 4.5,
  AZ: 3.0,
  AR: 4.2,
  CA: 3.2,
  CO: 2.8,
  CT: 2.5,
  DE: 2.8,
  DC: 2.5,
  FL: 3.5,
  GA: 3.5,
  HI: 3.8,
  ID: 3.2,
  IL: 2.8,
  IN: 2.5,
  IA: 2.0,
  KS: 1.8,
  KY: 4.0,
  LA: 3.8,
  ME: 4.0,
  MD: 2.8,
  MA: 3.2,
  MI: 3.5,
  MN: 2.5,
  MS: 4.5,
  MO: 2.8,
  MT: 3.2,
  NE: 1.5,
  NV: 2.8,
  NH: 2.8,
  NJ: 3.2,
  NM: 3.5,
  NY: 3.2,
  NC: 3.8,
  ND: 1.8,
  OH: 2.8,
  OK: 2.5,
  OR: 3.5,
  PA: 3.5,
  RI: 3.5,
  SC: 3.8,
  SD: 2.0,
  TN: 3.8,
  TX: 2.5,
  UT: 2.5,
  VT: 3.0,
  VA: 2.8,
  WA: 3.8,
  WV: 4.5,
  WI: 2.5,
  WY: 2.2,
};

/** Census 1953 median household income (USD). National ≈ $3,900. */
const MEDIAN_INCOME_1953: Record<string, number> = {
  AL: 2200,
  AK: 4800,
  AZ: 3400,
  AR: 2000,
  CA: 4500,
  CO: 3800,
  CT: 4800,
  DE: 4200,
  DC: 4200,
  FL: 3200,
  GA: 2600,
  HI: 3800,
  ID: 3200,
  IL: 4300,
  IN: 4000,
  IA: 3600,
  KS: 3500,
  KY: 2800,
  LA: 2800,
  ME: 2900,
  MD: 4200,
  MA: 4200,
  MI: 4200,
  MN: 3800,
  MS: 1800,
  MO: 3600,
  MT: 3400,
  NE: 3500,
  NV: 4300,
  NH: 3600,
  NJ: 4500,
  NM: 2900,
  NY: 4400,
  NC: 2600,
  ND: 3200,
  OH: 4100,
  OK: 3200,
  OR: 3900,
  PA: 3900,
  RI: 4000,
  SC: 2400,
  SD: 3000,
  TN: 2600,
  TX: 3300,
  UT: 3500,
  VT: 3000,
  VA: 3200,
  WA: 4200,
  WV: 2900,
  WI: 3900,
  WY: 4000,
};

/** 1953 poverty rate (%). National ≈ 26% (pre-War-on-Poverty; Great Society not yet passed). */
const POVERTY_1953: Record<string, number> = {
  AL: 50.0,
  AK: 22.0,
  AZ: 30.0,
  AR: 52.0,
  CA: 18.0,
  CO: 22.0,
  CT: 14.0,
  DE: 18.0,
  DC: 24.0,
  FL: 35.0,
  GA: 45.0,
  HI: 22.0,
  ID: 26.0,
  IL: 18.0,
  IN: 18.0,
  IA: 22.0,
  KS: 22.0,
  KY: 42.0,
  LA: 45.0,
  ME: 32.0,
  MD: 20.0,
  MA: 16.0,
  MI: 18.0,
  MN: 22.0,
  MS: 60.0,
  MO: 24.0,
  MT: 28.0,
  NE: 22.0,
  NV: 18.0,
  NH: 20.0,
  NJ: 15.0,
  NM: 38.0,
  NY: 18.0,
  NC: 46.0,
  ND: 28.0,
  OH: 18.0,
  OK: 32.0,
  OR: 20.0,
  PA: 20.0,
  RI: 18.0,
  SC: 52.0,
  SD: 30.0,
  TN: 42.0,
  TX: 34.0,
  UT: 24.0,
  VT: 26.0,
  VA: 36.0,
  WA: 18.0,
  WV: 40.0,
  WI: 18.0,
  WY: 20.0,
};

/** BEA 1953 real state GDP growth (%). National ≈ +3.8% (post-Korean-War boom). */
const GDP_GROWTH_1953: Record<string, number> = {
  AL: 3.5,
  AK: 5.0,
  AZ: 5.5,
  AR: 3.0,
  CA: 4.5,
  CO: 4.0,
  CT: 4.0,
  DE: 3.5,
  DC: 3.0,
  FL: 5.0,
  GA: 3.5,
  HI: 4.0,
  ID: 3.5,
  IL: 3.8,
  IN: 4.0,
  IA: 3.5,
  KS: 3.5,
  KY: 3.0,
  LA: 4.0,
  ME: 3.0,
  MD: 3.8,
  MA: 3.5,
  MI: 4.2,
  MN: 3.8,
  MS: 2.8,
  MO: 3.5,
  MT: 3.0,
  NE: 3.5,
  NV: 5.0,
  NH: 3.8,
  NJ: 3.8,
  NM: 4.0,
  NY: 3.2,
  NC: 3.5,
  ND: 3.2,
  OH: 4.0,
  OK: 3.5,
  OR: 4.0,
  PA: 3.5,
  RI: 3.2,
  SC: 3.0,
  SD: 3.2,
  TN: 3.5,
  TX: 4.5,
  UT: 4.0,
  VT: 3.0,
  VA: 3.8,
  WA: 4.0,
  WV: 3.0,
  WI: 3.8,
  WY: 3.5,
};

/** 1953 life expectancy at birth (years). National ≈ 68.8
 *  (antibiotics available since 1945; cardiac surgery primitive; polio endemic until 1955 vaccine). */
const LIFE_EXPECTANCY_1953: Record<string, number> = {
  AL: 64.5,
  AK: 67.0,
  AZ: 68.5,
  AR: 65.0,
  CA: 70.5,
  CO: 70.0,
  CT: 71.0,
  DE: 69.0,
  DC: 64.0,
  FL: 69.5,
  GA: 64.0,
  HI: 72.0,
  ID: 70.5,
  IL: 68.5,
  IN: 68.5,
  IA: 71.0,
  KS: 70.5,
  KY: 66.5,
  LA: 64.5,
  ME: 69.0,
  MD: 68.0,
  MA: 70.5,
  MI: 68.5,
  MN: 71.5,
  MS: 62.0,
  MO: 68.5,
  MT: 69.5,
  NE: 71.0,
  NV: 68.0,
  NH: 70.5,
  NJ: 70.0,
  NM: 67.5,
  NY: 69.5,
  NC: 65.0,
  ND: 71.5,
  OH: 68.5,
  OK: 67.5,
  OR: 70.5,
  PA: 68.5,
  RI: 70.0,
  SC: 64.0,
  SD: 70.5,
  TN: 65.5,
  TX: 67.5,
  UT: 71.5,
  VT: 70.5,
  VA: 66.5,
  WA: 70.5,
  WV: 66.0,
  WI: 70.5,
  WY: 69.5,
};

/** 1953 cost-of-living index (relative). National = 100. */
const COST_OF_LIVING_1953: Record<string, number> = {
  AL: 82,
  AK: 140,
  AZ: 95,
  AR: 80,
  CA: 108,
  CO: 98,
  CT: 110,
  DE: 102,
  DC: 122,
  FL: 92,
  GA: 85,
  HI: 155,
  ID: 92,
  IL: 106,
  IN: 94,
  IA: 90,
  KS: 88,
  KY: 86,
  LA: 90,
  ME: 98,
  MD: 108,
  MA: 112,
  MI: 102,
  MN: 98,
  MS: 80,
  MO: 92,
  MT: 94,
  NE: 90,
  NV: 105,
  NH: 104,
  NJ: 112,
  NM: 90,
  NY: 120,
  NC: 86,
  ND: 92,
  OH: 98,
  OK: 88,
  OR: 98,
  PA: 100,
  RI: 108,
  SC: 84,
  SD: 90,
  TN: 84,
  TX: 90,
  UT: 92,
  VT: 98,
  VA: 95,
  WA: 100,
  WV: 88,
  WI: 96,
  WY: 96,
};

/** 1953 population growth (% annual). National ≈ +1.8% — baby boom peak;
 *  Sunbelt migration just beginning; industrial North still dominant. */
const POP_GROWTH_1953: Record<string, number> = {
  AL: 0.8,
  AK: 3.5,
  AZ: 5.5,
  AR: 0.2,
  CA: 3.5,
  CO: 2.5,
  CT: 2.2,
  DE: 2.0,
  DC: 0.5,
  FL: 5.0,
  GA: 1.2,
  HI: 2.8,
  ID: 1.5,
  IL: 1.5,
  IN: 1.8,
  IA: 0.5,
  KS: 0.8,
  KY: 0.8,
  LA: 1.5,
  ME: 0.5,
  MD: 2.5,
  MA: 1.2,
  MI: 2.2,
  MN: 1.2,
  MS: 0.2,
  MO: 0.8,
  MT: 0.8,
  NE: 0.5,
  NV: 4.5,
  NH: 1.5,
  NJ: 2.5,
  NM: 3.0,
  NY: 1.2,
  NC: 1.2,
  ND: 0.2,
  OH: 1.8,
  OK: 0.8,
  OR: 2.0,
  PA: 0.8,
  RI: 1.0,
  SC: 0.8,
  SD: 0.2,
  TN: 1.0,
  TX: 2.5,
  UT: 2.8,
  VT: 0.5,
  VA: 2.0,
  WA: 2.2,
  WV: 0.2,
  WI: 1.5,
  WY: 1.0,
};

/** Urbanization (% urban; 1950 decennial). National ≈ 64%. */
const URBANIZATION_1953: Record<string, number> = {
  AL: 44,
  AK: 36,
  AZ: 56,
  AR: 33,
  CA: 81,
  CO: 63,
  CT: 78,
  DE: 63,
  DC: 100,
  FL: 65,
  GA: 45,
  HI: 69,
  ID: 42,
  IL: 77,
  IN: 60,
  IA: 48,
  KS: 53,
  KY: 36,
  LA: 55,
  ME: 40,
  MD: 69,
  MA: 84,
  MI: 71,
  MN: 55,
  MS: 28,
  MO: 61,
  MT: 36,
  NE: 47,
  NV: 57,
  NH: 57,
  NJ: 87,
  NM: 50,
  NY: 86,
  NC: 34,
  ND: 26,
  OH: 70,
  OK: 51,
  OR: 54,
  PA: 71,
  RI: 92,
  SC: 37,
  SD: 33,
  TN: 44,
  TX: 63,
  UT: 65,
  VT: 36,
  VA: 47,
  WA: 63,
  WV: 35,
  WI: 58,
  WY: 50,
};

/**
 * 1953 fertility index (0-100; population.birthRate — see metricDefinitions
 * `unit: "index"` and `uniformStateMetrics`. This is NOT a crude rate per
 * 1000; do not author a raw TFR or per-1000 figure here).
 *
 * This field was previously ABSENT from this file, so every US state fell
 * through to `uniformStateMetrics`'s generic `65 - medianAge*0.5` default —
 * which, at the 1950 median ages below (mostly 26-34), lands at ~49-51: the
 * NEUTRAL midpoint, i.e. a modern-day replacement-level reading. That silently
 * erased the baby boom: `demographics/flows/fertility.ts`'s
 * `birthRateIndexToTFR(index, replacementTFR)` anchors index 50 at
 * `REPLACEMENT_TFR` (2.06, `demographics/phase.ts`) and index 100 at
 * `2.06 * 1.6 = 3.296`. `population.birthRate` is also a STATIC ROOT metric —
 * no turn-engine node evolves it (unlike `medianAge`, which the demographic
 * phase updates every turn from the live cohort vector) — so whatever is
 * authored here is literally the fertility rate for the entire run. Index
 * ≈50 simulated a ~2019 replacement TFR for a country whose real 1953 TFR was
 * ≈3.3 (Vital Statistics of the United States, 1953; NCHS), so every turn of
 * `cohortFlows`'s fertility flow produced only replacement-level births and
 * the population aged FORWARD across the run instead of getting younger —
 * exactly backwards for 1953-66 America.
 *
 * CALIBRATION — not just "high", but high AND consistent with the authored
 * `medianAge` above. `seedSynthesis.ts`'s youth/adult split is SOLVED to
 * report the seeded median age, using the birth-rate index only as a prior
 * that bounds the solve to ±0.10 of population share; a birth rate whose
 * prior sits far from what the seeded median (plus the real 1950-census adult
 * shares, `stateCensusData1953.ts`) implies gets envelope-clamped rather than
 * honoured (see seedSynthesis.ts's doc comment on Turkey 1953 for the same
 * failure mode). Each value below is the HIGHEST index (found by bisecting
 * against the live solver, `synthesizeAgeSexVector`, using this state's real
 * adult census shares) that still lands the turn-0 synthesized median within
 * ~2 years of the authored `medianAge` — i.e. the most fertility signal this
 * state's authored inputs can carry without breaking its own seeded age
 * structure. The resulting synthesized medians therefore run 1-2 years
 * YOUNGER than the raw census figure above (e.g. CA 30.2 → synthesizes ~28.3;
 * MS 26.5 → ~24.6) — a small, correctly-directed bias, since 1953 sat only 7
 * years into an already-high-fertility period whose cumulative effect on the
 * age structure was still building. Resulting TFRs (`birthRateIndexToTFR`)
 * come out 2.3-2.5 for the industrial Northeast (historically low-fertility,
 * DC/NY/NH/NJ lowest) up to 3.0-3.3 for the rural South and Mountain
 * West/Utah (UT hits the model's own ceiling, matching Utah's real status as
 * the historic US fertility outlier) — the correct South/West-high,
 * Northeast-low direction, at the highest magnitude the seeded medians admit.
 */
const BIRTH_RATE_1953: Record<string, number> = {
  AL: 95,
  AK: 90,
  AZ: 85,
  AR: 85,
  CA: 70,
  CO: 80,
  CT: 65,
  DE: 80,
  DC: 50,
  FL: 75,
  GA: 90,
  HI: 85,
  ID: 85,
  IL: 65,
  IN: 80,
  IA: 70,
  KS: 65,
  KY: 75,
  LA: 90,
  ME: 65,
  MD: 75,
  MA: 55,
  MI: 80,
  MN: 65,
  MS: 95,
  MO: 65,
  MT: 70,
  NE: 65,
  NV: 75,
  NH: 60,
  NJ: 60,
  NM: 95,
  NY: 60,
  NC: 90,
  ND: 70,
  OH: 75,
  OK: 75,
  OR: 65,
  PA: 65,
  RI: 60,
  SC: 95,
  SD: 75,
  TN: 85,
  TX: 90,
  UT: 100,
  VT: 65,
  VA: 85,
  WA: 75,
  WV: 75,
  WI: 75,
  WY: 75,
};

/** Median age by state (1950 Census). National ≈ 30.2
 *  (pre-baby-boom; WWII vets returning; slightly older median than 1979). */
const MEDIAN_AGE_1953: Record<string, number> = {
  AL: 27.0,
  AK: 26.5,
  AZ: 28.5,
  AR: 29.5,
  CA: 30.2,
  CO: 28.8,
  CT: 33.5,
  DE: 29.5,
  DC: 33.5,
  FL: 32.5,
  GA: 27.5,
  HI: 28.0,
  ID: 28.5,
  IL: 31.5,
  IN: 29.5,
  IA: 32.0,
  KS: 31.5,
  KY: 30.0,
  LA: 27.0,
  ME: 33.0,
  MD: 30.5,
  MA: 34.5,
  MI: 29.5,
  MN: 31.5,
  MS: 26.5,
  MO: 32.5,
  MT: 31.0,
  NE: 31.5,
  NV: 30.5,
  NH: 33.5,
  NJ: 33.5,
  NM: 26.5,
  NY: 33.5,
  NC: 27.5,
  ND: 30.5,
  OH: 30.5,
  OK: 30.5,
  OR: 31.5,
  PA: 33.5,
  RI: 34.0,
  SC: 26.5,
  SD: 30.5,
  TN: 28.5,
  TX: 27.5,
  UT: 24.5,
  VT: 31.5,
  VA: 28.5,
  WA: 30.5,
  WV: 31.0,
  WI: 30.5,
  WY: 29.0,
};

// ── 1953 soft-index national baselines ──────────────────────────────────────
const BASELINE_1953 = {
  // Media — the early-TV, newspaper-dominant era. Three broadcast networks;
  // no cable; McCarthyism at peak. Polarization low by structure but suppressed.
  mediaPolarization: 32,
  disinformationRisk: 22, // McCarthyism and Red Scare propaganda
  pressFreedom: 62, // McCarthyism chills dissent
  newsTrust: 60, // pre-Watergate; trust high
  socialMediaSentiment: 0,

  // Public Safety — low crime, low incarceration, pre-drug-war era.
  crimeRate: 1750, // FBI UCR 1953 property crime per 100k (historical low)
  violentCrimeRate: 160, // FBI UCR 1953 violent crime per 100k
  policePerCapita: 1.4,
  incarcerationRate: 98, // 1953 — the absolute historical low
  recidivismRate: 45,
  publicSafetyConfidence: 68,

  // Governance — post-WWII, McCarthy era, bipartisan Cold War consensus.
  governmentTransparency: 42, // McCarthy-era secrecy culture
  budgetBalance: 0.4, // FY1953 federal budget near balance (Korean War winding down)
  debtToGdp: 68, // WWII + Korean War debt; high gross federal debt/GDP
  corruptionIndex: 35,
  voterTurnout: 63, // 1952 Eisenhower election: 63% turnout
  publicTrust: 72, // pre-Watergate, pre-Vietnam; institutional trust very high
  coDeterminationQuality: 65, // union density at peak ~35%

  // Education — 1953 baseline; pre-NDEA (1958); pre-Civil-Rights.
  highSchoolGradRate: 52, // ~52% HS completion; many left school early for factory jobs
  universityEnrollment: 26, // lower than 1979; GI Bill surge was 1946-52
  testPerformance: 85,
  educationSpending: 350, // NCES 1953 per-pupil ≈ $350 nominal
  literacyRate: 89, // high by global standards but lower functional literacy
  workforceSkill: 42,
  apprenticeshipRate: 4.5, // peak union apprenticeship pipeline

  // Environment — pre-EPA; heavily industrial; coal dominant.
  airQuality: 12, // pre-Clean Air Act; coal smog in cities
  renewableEnergy: 30, // hydro only but significant (TVA, Hoover Dam, etc.); coal ~51%
  carbonEmissions: 10, // ≈10 t/capita — lower absolute but dirty per-unit energy
  recyclingRate: 3,
  climateResilience: 45,
  protectedLand: 7,
  energyTransitionProgress: 2,

  // Social — high mobility, VERY LOW inequality, strong cohesion.
  socialMobility: 72, // peak postwar mobility; GI Bill, cheap housing, manufacturing jobs
  incomeInequality: 22, // Gini 1953 ≈ 0.37 — the most equal modern era
  homelessnessRate: 3, // low; full employment; cheap housing
  foodInsecurity: 18, // higher than 1979; pre-food-stamp era (FSEP started 1961)
  civicParticipation: 65, // high; civic organizations at their peak
  socialCohesion: 72, // high wartime/postwar solidarity
  housingSupplyGrowth: 3.5, // suburban boom; Levittown era

  // Healthcare — pre-Medicare/Medicaid; mostly private; antibiotics new.
  uninsuredRate: 38.0, // pre-Medicare; vast majority uninsured for hospitalization
  affordabilityIndex: 35, // unaffordable for many; most care cash-pay
  physicianRate: 1.4, // ≈1.4 physicians/1000 in 1953
  preventableMortality: 680, // high; pre-modern cardiac care
  publicHealthPreparedness: 38, // polio epidemic ongoing (vaccine 1955)
};

function econTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_1953[stateId] ?? 3900;
  if (income >= 4200) return 5;
  if (income >= 3800) return 4;
  if (income >= 3200) return 3;
  if (income >= 2600) return 2;
  return 1;
}

function eduTier(stateId: string): 1 | 2 | 3 | 4 | 5 {
  const income = MEDIAN_INCOME_1953[stateId] ?? 3900;
  if (income >= 4200) return 5;
  if (income >= 3800) return 4;
  if (income >= 3200) return 3;
  if (income >= 2600) return 2;
  return 1;
}

function build1953Metrics(stateId: string): StateMetrics {
  const et = econTier(stateId) - 1;
  const ed = eduTier(stateId) - 1;
  const urban = URBANIZATION_1953[stateId] ?? 64;
  const popGrowth = POP_GROWTH_1953[stateId] ?? 1.8;
  const medAge = MEDIAN_AGE_1953[stateId] ?? 30.2;
  const birthRate = BIRTH_RATE_1953[stateId] ?? 75; // national-average fallback; see BIRTH_RATE_1953 doc
  const unemp = UNEMP_1953[stateId] ?? 2.9;
  const income = MEDIAN_INCOME_1953[stateId] ?? 3900;
  const poverty = POVERTY_1953[stateId] ?? 26;
  const gdpGrowth = GDP_GROWTH_1953[stateId] ?? 3.8;
  const lifeExp = LIFE_EXPECTANCY_1953[stateId] ?? 68.8;
  const col = COST_OF_LIVING_1953[stateId] ?? 100;

  const leanMod = (et - 2) * 2;
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
      smallBusinessFormation: mv([2.0, 2.5, 3.0, 3.5, 4.0][et]), // high-rate environment, strong unions limit small-biz
      laborParticipation: mv(59.2), // 1953 LFPR ≈ 59.2% (women mostly not in workforce)
      matchingFriction: mv(3), // very low friction; full employment era
      tradeBalance: mv(5), // US ran a trade surplus in 1953
      productivityGrowth: mv(Math.round(gdpGrowth * 0.55 * 10) / 10), // high postwar productivity growth
      rdIntensity: mv(0.4 + ed * 0.15), // defense R&D; mostly government; low commercial R&D
      exportDependency: mv(8), // very low trade dependence; autarkic economy
      manufacturingCompetitiveness: mv(Math.max(75, Math.min(99, [80, 87, 92, 96, 99][ed]))), // peak manufacturing era
    },

    education: {
      highSchoolGradRate: mv(Math.max(30, BASELINE_1953.highSchoolGradRate + leanMod * 1.0)),
      universityEnrollment: mv(Math.max(15, BASELINE_1953.universityEnrollment + leanMod * 0.8)),
      testPerformance: mv(BASELINE_1953.testPerformance + leanMod * 1.5),
      educationSpending: mv(BASELINE_1953.educationSpending + leanMod * 30),
      literacyRate: mv(Math.max(70, BASELINE_1953.literacyRate + leanMod * 0.5)),
      workforceSkill: mv(BASELINE_1953.workforceSkill + leanMod * 2),
      apprenticeshipRate: mv(BASELINE_1953.apprenticeshipRate), // uniform; union system
    },

    healthcare: {
      uninsuredRate: mv(Math.max(18, BASELINE_1953.uninsuredRate - leanMod * 2.0)),
      affordabilityIndex: mv(Math.max(20, BASELINE_1953.affordabilityIndex + leanMod * 2)),
      physicianRate: mv(BASELINE_1953.physicianRate + leanMod * 0.04),
      lifeExpectancy: mv(lifeExp),
      preventableMortality: mv(Math.max(500, BASELINE_1953.preventableMortality - leanMod * 25)),
      publicHealthPreparedness: mv(BASELINE_1953.publicHealthPreparedness + leanMod * 2),
    },

    infrastructure: {
      roadCondition: mv([40, 52, 62, 72, 82][infra]), // pre-Interstate; mostly 2-lane federal highways
      broadbandAccess: mv(0), // no broadband in 1953
      publicTransit: mv(Math.round(urban * 0.4 + infra * 3)), // streetcars being replaced by buses
      waterQuality: mv([60, 70, 78, 86, 92][infra]),
      powerGridReliability: mv([97.5, 98.0, 98.8, 99.2, 99.6][infra]),
      infrastructureInvestmentGap: mv([52, 44, 36, 28, 20][infra]),
    },

    publicSafety: {
      crimeRate: mv(Math.max(800, BASELINE_1953.crimeRate + (urban - 64) * 5 - leanMod * 30)),
      violentCrimeRate: mv(
        Math.max(60, BASELINE_1953.violentCrimeRate + (urban - 64) * 1.2 - leanMod * 8)
      ),
      policePerCapita: mv(BASELINE_1953.policePerCapita + urban * 0.003),
      incarcerationRate: mv(Math.max(40, BASELINE_1953.incarcerationRate - leanMod * 4)),
      recidivismRate: mv(BASELINE_1953.recidivismRate - leanMod * 2),
      publicSafetyConfidence: mv(BASELINE_1953.publicSafetyConfidence + leanMod * 2),
    },

    environment: {
      airQuality: mv(Math.max(4, BASELINE_1953.airQuality - leanMod * 1.5 + urban * 0.03)),
      renewableEnergy: mv(Math.max(1, BASELINE_1953.renewableEnergy + leanMod * 1.5)),
      carbonEmissions: mv(BASELINE_1953.carbonEmissions - leanMod * 0.3),
      recyclingRate: mv(Math.max(1, BASELINE_1953.recyclingRate + leanMod * 0.5)),
      climateResilience: mv(BASELINE_1953.climateResilience + leanMod * 2),
      protectedLand: mv(BASELINE_1953.protectedLand + (100 - urban) * 0.06),
      energyTransitionProgress: mv(Math.max(1, BASELINE_1953.energyTransitionProgress + leanMod)),
    },

    social: {
      socialMobility: mv(Math.max(50, BASELINE_1953.socialMobility + leanMod * 3)),
      incomeInequality: mv(
        Math.max(15, Math.min(42, BASELINE_1953.incomeInequality - leanMod * 2))
      ),
      homelessnessRate: mv(
        Math.max(1, BASELINE_1953.homelessnessRate + (col - 100) * 0.03 + urban * 0.02)
      ),
      foodInsecurity: mv(Math.max(8, BASELINE_1953.foodInsecurity - leanMod * 1.2)),
      civicParticipation: mv(Math.max(45, BASELINE_1953.civicParticipation + leanMod * 2)),
      socialCohesion: mv(Math.max(40, BASELINE_1953.socialCohesion + leanMod * 2 - urban * 0.05)),
      housingSupplyGrowth: mv(BASELINE_1953.housingSupplyGrowth + popGrowth * 0.3),
    },

    governance: {
      governmentTransparency: mv(BASELINE_1953.governmentTransparency + leanMod * 2),
      budgetBalance: mv(BASELINE_1953.budgetBalance + leanMod * 0.3),
      debtToGdp: mv(Math.max(30, BASELINE_1953.debtToGdp - leanMod * 3)),
      corruptionIndex: mv(Math.max(15, BASELINE_1953.corruptionIndex - leanMod * 2)),
      voterTurnout: mv(Math.max(35, BASELINE_1953.voterTurnout + leanMod)),
      publicTrust: mv(Math.max(45, BASELINE_1953.publicTrust + leanMod * 2)),
      coDeterminationQuality: mv(Math.max(40, BASELINE_1953.coDeterminationQuality + leanMod)),
    },

    population: {
      populationGrowth: mv(popGrowth),
      urbanizationRate: mv(urban),
      medianAge: mv(medAge),
      birthRate: mv(birthRate),
      migrationRate: mv(popGrowth - 0.4),
    },

    mediaInformation: {
      mediaPolarization: mv(Math.min(55, BASELINE_1953.mediaPolarization + Math.abs(leanMod) * 2)),
      disinformationRisk: mv(Math.min(50, BASELINE_1953.disinformationRisk + Math.abs(leanMod))),
      pressFreedom: mv(BASELINE_1953.pressFreedom + leanMod),
      socialMediaSentiment: mv(BASELINE_1953.socialMediaSentiment + leanMod * 2),
      newsTrust: mv(Math.max(40, BASELINE_1953.newsTrust + leanMod)),
    },

    lastUpdated: new Date(0),
  });
}

export const stateMetrics1953: StateMetrics[] = states1953
  .filter((s) => s.countryId === "US")
  .map((s) => build1953Metrics(s._id));
