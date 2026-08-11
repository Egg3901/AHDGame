import type { MetricPresetBundle } from "@/lib/seeds/uk/ukMetricPresets";

/**
 * 1979 UK — Thatcher's first year (elected May 1979; Conservative majority 43 seats).
 * End of the "winter of discontent"; 13.4% CPI inflation; North Sea oil just ramping up
 * (~1.6M bbl/day, not yet peak); Howe budget doubled VAT to 15%, cut income tax (top 83%→60%).
 * Manufacturing still large but starting structural decline (steel, textiles, coal). NHS intact
 * but under fiscal pressure. National Service ended 1960; professional army + NATO. No broadband.
 * No devolved assemblies. Post-Callaghan Labour defeat. Public debt ~44% GDP.
 */

const UK_REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
] as const;

const NATIONAL_1979: Record<string, number> = {
  "economic.laborParticipation": 60, // higher than 1953; married women working more
  "economic.matchingFriction": 4.5, // high and rising unemployment (5.1% → 11%)
  "economic.tradeBalance": -1.5, // current account deficit; North Sea ramping up
  "economic.productivityGrowth": 1.2, // stagflation era; low productivity growth
  "economic.rdIntensity": 1.5, // defence-heavy R&D; civilian industrial R&D
  "economic.propertyValueIndex": 55, // 1979 property cheaper than 2019 but above 1953
  "economic.commercialValueIndex": 50,
  "economic.ruralRevitalization": 48, // agriculture declining share; countryside suburbanising
  "economic.foodSecurity": 68, // food secure; some North Sea gas affects energy
  "economic.exportDependency": 28, // EEC membership (1973) increased export dependency
  "economic.manufacturingCompetitiveness": 72, // declining from 1953 peak but still strong
  "economic.regulatoryBurden": 52, // nationalised industries still dominant; heavy
  "economic.economicFreedom": 62, // pre-Thatcher reforms; still mixed economy
  "education.highSchoolGradRate": 60, // O-levels; raising school leaving age to 16 (1972)
  "education.gcseAttainment": 38, // CSE/O-level system; below modern
  "education.universityEnrollment": 13, // still elite but widening
  "education.apprenticeshipRate": 3.0, // traditional apprenticeships; pre-collapse
  "education.academicPressure": 50,
  "healthcare.uninsuredRate": 2, // NHS universal (1948) — still intact 1979
  "healthcare.affordabilityIndex": 78, // NHS free at point of use
  "healthcare.nhsWaitingTime": 42, // waiting lists building pre-reforms
  "healthcare.mentalHealthAccess": 22, // asylums; community care beginning
  "healthcare.socialCareQuality": 40,
  "healthcare.elderCareQuality": 40,
  "infrastructure.transportEfficiency": 57, // motorways (M25 not until 1986); BR rail adequate
  "publicSafety.antiSocialBehaviourRate": 6, // rising crime (peak 1995)
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 15,
  "environment.naturalDisasterPreparedness": 55,
  "environment.nuclearSafety": 58, // Magnox/AGR plants operating; Windscale (1957 scar)
  "environment.energyTransitionProgress": 5, // North Sea oil; coal still dominant
  "social.childPoverty": 22, // post-Beveridge welfare state; better than 1953
  "social.housingAffordability": 9, // rising house prices post-1970; below 2019 bubble
  "social.roughSleeping": 4,
  "social.workLifeBalance": 52, // 40-hr norm; limited statutory leave
  "social.foreignWorkerIntegration": 50, // Commonwealth immigration wave absorbed; Race Relations Act 1976
  "social.genderEquality": 40, // Sex Discrimination Act (1975); ERA still not enacted
  "social.housingSupplyGrowth": 2.0, // council house building slowing; right-to-buy coming
  "governance.debtToGdp": 44, // declining from post-WWII highs
  "governance.devolutionSatisfaction": 48, // 1979 devolution referendums failed (Scotland/Wales)
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 65, // recovering from 1970s malaise; Thatcher optimism
  "governance.civilLiberties": 72, // Section 28 not until 1988; Paki-bashing an issue
  "governance.militaryReadiness": 72, // NATO Cold War; professional army; Falklands 1982
  "population.demographicDecline": 30, // baby boom fading; declining birth rate
  "mediaInformation.bbcTrust": 72, // BBC high trust; ITV second channel; pre-Sky
  "mediaInformation.stateMediaControl": 22, // BBC public-but-independent; commercial ITV regulated
};

const TILTS_1979: Record<string, Record<string, number>> = {
  LON: {
    "economic.propertyValueIndex": 72,
    "economic.commercialValueIndex": 75,
    "economic.manufacturingCompetitiveness": 58, // London de-industrialising fast
    "economic.exportDependency": 40,
    "economic.rdIntensity": 2.0,
    "education.universityEnrollment": 18,
    "infrastructure.transportEfficiency": 75, // Underground, BR commuter; no Jubilee extension yet
    "social.foreignWorkerIntegration": 62,
    "social.housingAffordability": 7,
    "social.childPoverty": 18,
    "governance.nationalPride": 62,
    "population.demographicDecline": 25,
  },
  WMI: {
    "economic.manufacturingCompetitiveness": 80, // Birmingham / Black Country; still industrialised
    "economic.laborParticipation": 62,
    "social.childPoverty": 25,
  },
  YHU: {
    "economic.manufacturingCompetitiveness": 78, // Yorkshire steel/textiles; Arthur Scargill era
    "social.childPoverty": 26,
    "governance.civilLiberties": 70,
  },
  NWE: {
    "economic.manufacturingCompetitiveness": 76, // Manchester / Merseyside; car/textile
    "social.childPoverty": 25,
    "population.demographicDecline": 32,
  },
  NEE: {
    "economic.manufacturingCompetitiveness": 74,
    "social.childPoverty": 28,
    "governance.nationalPride": 62,
    "population.demographicDecline": 35,
  },
  SCO: {
    "economic.manufacturingCompetitiveness": 75, // Clyde shipbuilding still active; North Sea oil proximity
    "social.childPoverty": 25,
    "governance.devolutionSatisfaction": 52, // 1979 devolution referendum failed (40% yes; 52% turnout)
    "mediaInformation.bbcTrust": 70,
    "environment.floodRisk": 8,
    "environment.energyTransitionProgress": 8, // North Sea oil fields offshore Scotland
    "population.demographicDecline": 32,
  },
  WAL: {
    "economic.manufacturingCompetitiveness": 74, // coal/steel; still active pre-pit closures
    "social.childPoverty": 26,
    "governance.devolutionSatisfaction": 46, // Wales voted No to devolution 1979 (80% no)
    "environment.floodRisk": 6,
    "population.demographicDecline": 30,
  },
  NIR: {
    "governance.civilLiberties": 55, // The Troubles; Bloody Sunday (1972); Army presence
    "governance.devolutionSatisfaction": 42,
    "social.foreignWorkerIntegration": 28,
    "social.childPoverty": 28,
    "mediaInformation.bbcTrust": 65,
    "environment.floodRisk": 6,
    "governance.nationalPride": 55,
  },
  SWE: {
    "economic.ruralRevitalization": 58,
    "economic.foodSecurity": 75,
    "social.childPoverty": 18,
    "environment.energyTransitionProgress": 8, // Wiltshire/Dorset — early wind awareness
  },
  EAE: {
    "economic.ruralRevitalization": 60,
    "economic.foodSecurity": 78,
    "social.childPoverty": 20,
  },
  EMI: {
    "economic.manufacturingCompetitiveness": 76,
    "infrastructure.transportEfficiency": 55,
  },
  SEE: {
    "economic.rdIntensity": 1.8,
    "economic.manufacturingCompetitiveness": 68,
    "infrastructure.transportEfficiency": 68,
    "population.demographicDecline": 28,
  },
};

export const ukMetricPresets1979: MetricPresetBundle = Object.fromEntries(
  UK_REGIONS.map((region) => [region, { ...NATIONAL_1979, ...(TILTS_1979[region] ?? {}) }])
);
