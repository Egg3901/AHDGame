import type { MetricPresetBundle } from "@/lib/seeds/reference/usMetricPresets";

/**
 * 1953 United States — Eisenhower's first year. Korean War armistice (July 1953); Cold War
 * peak (McCarthyism; hydrogen bomb tested 1952); Korean War military spending ~14% GDP;
 * GI Bill driving college boom; baby boom; Taft-Hartley Act (1947) still shaping labour;
 * Solid South (Jim Crow / Dixiecrats); no Interstate Highway System (started 1956); no Medicare
 * or Medicaid (1965); no nuclear power plants (Shippingport opened 1958). Women's marriage
 * bar informal but strong — most women left paid work on marriage. Inflation ~0.5% (post-Korean
 * demobilisation). Public debt ~66% GDP (post-WWII still declining). Median household income
 * ~$3,900/yr in 1953 nominals.
 */

type Archetype = "TECH" | "NEMA" | "RUST" | "SOUTH" | "PLAINS" | "MOUNTAIN";

const STATE_ARCHETYPE: Record<string, Archetype> = {
  CA: "TECH",
  WA: "TECH",
  MA: "TECH",
  NY: "TECH",
  CO: "TECH",
  OR: "TECH",
  CT: "NEMA",
  NH: "NEMA",
  VT: "NEMA",
  ME: "NEMA",
  RI: "NEMA",
  NJ: "NEMA",
  MD: "NEMA",
  DE: "NEMA",
  HI: "NEMA",
  VA: "NEMA",
  MN: "NEMA",
  DC: "NEMA",
  PA: "RUST",
  OH: "RUST",
  MI: "RUST",
  IL: "RUST",
  IN: "RUST",
  WI: "RUST",
  MO: "RUST",
  AL: "SOUTH",
  AR: "SOUTH",
  KY: "SOUTH",
  LA: "SOUTH",
  MS: "SOUTH",
  SC: "SOUTH",
  TN: "SOUTH",
  GA: "SOUTH",
  NC: "SOUTH",
  WV: "SOUTH",
  OK: "SOUTH",
  FL: "SOUTH",
  TX: "SOUTH",
  IA: "PLAINS",
  KS: "PLAINS",
  NE: "PLAINS",
  ND: "PLAINS",
  SD: "PLAINS",
  MT: "MOUNTAIN",
  ID: "MOUNTAIN",
  WY: "MOUNTAIN",
  UT: "MOUNTAIN",
  NV: "MOUNTAIN",
  AZ: "MOUNTAIN",
  NM: "MOUNTAIN",
  AK: "MOUNTAIN",
};

const US_REGIONS = Object.keys(STATE_ARCHETYPE);

function expand(
  national: Record<string, number>,
  archetypes: Record<Archetype, Record<string, number>>,
  overrides: Record<string, Record<string, number>>
): MetricPresetBundle {
  return Object.fromEntries(
    US_REGIONS.map((state) => [
      state,
      { ...national, ...(archetypes[STATE_ARCHETYPE[state]] ?? {}), ...(overrides[state] ?? {}) },
    ])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1953
// ─────────────────────────────────────────────────────────────────────────────

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 59, // men 87%; women 34%; married women largely excluded
  "economic.matchingFriction": 2.5, // unemployment only 2.9% (Korean War peak)
  "economic.tradeBalance": 1.5, // small trade surplus (Marshall Plan exports)
  "economic.productivityGrowth": 3.5, // strong post-war productivity
  "economic.rdIntensity": 0.6, // DoD R&D secret/separate; civilian very low
  "economic.propertyValueIndex": 35, // 1953 median home ~$9,500 (vs ~$300k 2019)
  "economic.commercialValueIndex": 30,
  "economic.ruralRevitalization": 60, // significant farm population (still ~15% agrarian)
  "economic.foodSecurity": 82, // post-rationing; cheap food
  "economic.exportDependency": 20, // Marshall Plan pushed exports; still domestic-focused
  "economic.manufacturingCompetitiveness": 85, // peak US industrial dominance (40% world output)
  // Right-lane approval badges (economic_freedom ≥75 & burden <35) — sit just
  // below so day-one US does not freefire the Phase-B mirrors; still historically
  // freer than most peers and reachable via deregulatory bills.
  "economic.regulatoryBurden": 40, // New Deal agencies; Eisenhower moderate
  "economic.economicFreedom": 70, // free enterprise but strong antitrust, union power
  "education.highSchoolGradRate": 52, // ~52% graduated HS in 1953 cohort
  "education.universityEnrollment": 20, // GI Bill driving boom (from 15% in 1945)
  "education.apprenticeshipRate": 1.2, // UAW/CWA apprenticeships; less formalised than Europe
  "education.academicPressure": 30, // Cold War Sputnik panic not yet (1957)
  "healthcare.uninsuredRate": 50, // no Medicare/Medicaid; employer coverage expanding
  "healthcare.affordabilityIndex": 55, // care cheap in 1953 nominals but still 50% uninsured
  "healthcare.mentalHealthAccess": 15, // state asylums only; no community mental health
  "healthcare.socialCareQuality": 25, // Social Security 1935 but very limited scope
  "healthcare.elderCareQuality": 28,
  "infrastructure.transportEfficiency": 42, // rail good; no Interstates yet (1956); roads improving
  "publicSafety.antiSocialBehaviourRate": 4, // low crime era
  "publicSafety.knifeCrimeRate": 1,
  // Below broad_firearm_rights (≥88); still >1991 national/ordered vs 2019.
  "publicSafety.firearmRights": 85, // pre-GCA-1968; NFA 1934 the only major federal statute
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 45,
  "environment.nuclearSafety": 0, // no civilian nuclear plants (Shippingport 1958)
  "environment.energyTransitionProgress": 0, // coal + oil economy
  "social.childPoverty": 30, // no food stamps (1964); AFDC minimal; large poor pop
  // Above affordable_housing (≤28) so the badge is earned; still far cheaper
  // than modern US norms (2019 national ~55).
  "social.housingAffordability": 30, // housing cheap relative to income (pre-boom)
  "social.roughSleeping": 3,
  "social.workLifeBalance": 52, // 40-hr week (FLSA 1938); no paid leave mandate
  "social.foreignWorkerIntegration": 38, // restrictive immigration; Bracero programme; McCarthy era
  "social.genderEquality": 18, // women expected to leave work on marriage; no ERA
  "social.housingSupplyGrowth": 3.8, // Levittown suburban boom (1950-54 peak)
  "governance.debtToGdp": 68, // post-WWII debt declining (from 110% peak 1945)
  "governance.devolutionSatisfaction": 55, // states rights discourse strong; Eisenhower federalism
  "governance.roboticsAdoption": 0,
  // Below national_confidence (≥86) / strong_defense (pride ≥85); also below the
  // pre-fix ≥79 gate so live worlds stay clean until the threshold bump deploys.
  "governance.nationalPride": 78, // post-WWII peak; Cold War patriotism; Korea "victory"
  "governance.civilLiberties": 52, // McCarthyism (1950-54 peak); Jim Crow; free press
  "governance.militaryReadiness": 85, // Korean War; largest peacetime military in US history
  // Below secure_border (≥62); still tighter than 2019/1991 national baselines.
  "governance.borderSecurity": 60, // national-origins quota era (1924 act still in force)
  "population.demographicDecline": 12, // baby boom (inverse of decline — strongly positive)
  "mediaInformation.stateMediaControl": 10, // fairness doctrine but NOT state control; free press
};

const ARCHETYPES_1953: Record<Archetype, Record<string, number>> = {
  TECH: {
    "economic.rdIntensity": 1.0, // DoD contracts + nascent aerospace (CA)
    "economic.propertyValueIndex": 42,
    "economic.commercialValueIndex": 45,
    "economic.exportDependency": 28,
    "economic.manufacturingCompetitiveness": 82, // aerospace/defence manufacturing
    "education.universityEnrollment": 28,
    "social.genderEquality": 22,
    "social.childPoverty": 25,
    "social.foreignWorkerIntegration": 48,
    "governance.civilLiberties": 58,
  },
  NEMA: {
    "education.highSchoolGradRate": 60,
    "education.universityEnrollment": 28,
    "healthcare.uninsuredRate": 42, // more employer coverage (unionised East Coast)
    "economic.manufacturingCompetitiveness": 80,
    "social.childPoverty": 24,
    "governance.civilLiberties": 62,
    "social.genderEquality": 22,
    "infrastructure.transportEfficiency": 52, // Northeast corridor rail
  },
  RUST: {
    "economic.manufacturingCompetitiveness": 90, // peak Steel Belt / UAW era
    "economic.laborParticipation": 62,
    "economic.tradeBalance": 2.5,
    "social.childPoverty": 28,
    "healthcare.uninsuredRate": 40, // UAW/CIO union health plans
    "governance.civilLiberties": 58,
    "social.foreignWorkerIntegration": 42, // Polish/Italian/Black Southern migration
  },
  SOUTH: {
    "governance.civilLiberties": 30, // Jim Crow — Black civil rights near zero
    "social.genderEquality": 12, // compounded gender + race suppression
    "social.childPoverty": 45, // high poverty; large Black sharecropper population
    "education.highSchoolGradRate": 38, // dual school system; Black schools underfunded
    "education.universityEnrollment": 12,
    "healthcare.uninsuredRate": 62, // very low employer coverage
    "economic.manufacturingCompetitiveness": 72, // tobacco/textile/defence
    "social.foreignWorkerIntegration": 20, // strict racial hierarchy
    "governance.devolutionSatisfaction": 65, // states rights (segregation)
    "infrastructure.transportEfficiency": 32, // poor roads (no Interstates)
    "economic.ruralRevitalization": 75, // sharecropping/tobacco/cotton still large
  },
  PLAINS: {
    "economic.ruralRevitalization": 80,
    "economic.foodSecurity": 90, // breadbasket states
    "economic.manufacturingCompetitiveness": 65,
    "social.childPoverty": 28,
    "governance.devolutionSatisfaction": 58,
    "social.foreignWorkerIntegration": 28,
    "infrastructure.transportEfficiency": 38,
  },
  MOUNTAIN: {
    "economic.ruralRevitalization": 72,
    "economic.manufacturingCompetitiveness": 60,
    "environment.naturalDisasterPreparedness": 40,
    "social.childPoverty": 30,
    "social.foreignWorkerIntegration": 35,
    "infrastructure.transportEfficiency": 35,
    "governance.devolutionSatisfaction": 60,
  },
};

const OVERRIDES_1953: Record<string, Record<string, number>> = {
  // Deep South — most severe Jim Crow
  MS: {
    "governance.civilLiberties": 20,
    "social.childPoverty": 55,
    "education.highSchoolGradRate": 30,
  },
  AL: { "governance.civilLiberties": 22, "social.childPoverty": 52 },
  SC: { "governance.civilLiberties": 22, "social.childPoverty": 50 },
  GA: { "governance.civilLiberties": 25, "social.childPoverty": 48 },
  LA: {
    "governance.civilLiberties": 23,
    "social.childPoverty": 50,
    "healthcare.uninsuredRate": 68,
  },
  // Border South — less severe but still Jim Crow
  KY: { "governance.civilLiberties": 40, "social.childPoverty": 38 },
  TN: { "governance.civilLiberties": 35, "social.childPoverty": 40 },
  // NYC / DC — urban liberal exceptions
  NY: {
    "economic.propertyValueIndex": 50,
    "economic.commercialValueIndex": 60,
    "governance.civilLiberties": 68,
    "social.genderEquality": 28,
    "infrastructure.transportEfficiency": 65,
    "social.foreignWorkerIntegration": 55,
  },
  DC: {
    "governance.civilLiberties": 55, // segregated DC but federal presence
    "economic.propertyValueIndex": 45,
    "economic.commercialValueIndex": 50,
  },
  // California — aerospace + immigration
  CA: {
    "economic.rdIntensity": 1.2,
    "social.foreignWorkerIntegration": 52,
    "environment.naturalDisasterPreparedness": 50,
    "governance.civilLiberties": 60,
  },
  // Texas — oil boom starting; mixed
  TX: {
    "economic.ruralRevitalization": 68,
    "economic.exportDependency": 25, // oil exports
    "environment.energyTransitionProgress": 0,
    "governance.civilLiberties": 28,
  },
  // Michigan — peak auto
  MI: {
    "economic.manufacturingCompetitiveness": 92,
    "healthcare.uninsuredRate": 35, // UAW health plans best in nation
    "economic.laborParticipation": 65,
  },
  // West Virginia — coal
  WV: {
    "economic.manufacturingCompetitiveness": 75, // coal mining
    "social.childPoverty": 48,
    "governance.civilLiberties": 45,
    "infrastructure.transportEfficiency": 28,
  },
  // Massachusetts — Harvard/MIT + industry
  MA: {
    "economic.rdIntensity": 1.5,
    "governance.civilLiberties": 65,
  },
  // Hawaii — not yet a state (admitted 1959)
  HI: {
    "social.foreignWorkerIntegration": 65, // Japanese-American majority; very multicultural
    "governance.civilLiberties": 58,
    "economic.exportDependency": 35,
  },
  // Alaska — not yet a state (admitted 1959)
  AK: {
    "economic.ruralRevitalization": 85,
    "social.foreignWorkerIntegration": 30,
    "infrastructure.transportEfficiency": 20,
    "governance.civilLiberties": 58,
  },
};

export const usMetricPresets1953: MetricPresetBundle = expand(
  NATIONAL_1953,
  ARCHETYPES_1953,
  OVERRIDES_1953
);
