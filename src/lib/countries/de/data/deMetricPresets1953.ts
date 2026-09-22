import type { MetricPresetBundle } from "@/lib/seeds/de/deMetricPresets";

/**
 * 1953 West Germany — Adenauer's CDU/CSU government; "Wirtschaftswunder" early phase;
 * London Debt Conference (Feb 1953) wrote off most WWII debt → near-zero debtToGdp;
 * Marshall Plan winding down but having transformed the economy; Bundesrepublik established
 * 1949; no Bundeswehr yet (formed 1955; rearmament debate ongoing); DGB union density ~40%;
 * no nuclear power (first plant Kahl 1961); no motorways beyond pre-war Autobahn (being
 * rebuilt); massive reconstruction housing boom; Codetermination Act 1951 (coal/steel only);
 * Berlin still divided but West Berlin integrated into BRD economy.
 */

const DE_REGIONS = [
  "BW",
  "BY",
  "NW",
  "HE",
  "RP",
  "SL",
  "NI",
  "SH",
  "HH",
  "BRE",
  "BE",
  "BB",
  "MV",
  "SN",
  "ST",
  "TH", // These are post-1990 East German Länder — for 1953 map to Western BRD zones
] as const;

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 60, // high male participation, women leaving workforce
  "economic.matchingFriction": 4.0, // labour shortages in reconstruction
  "economic.tradeBalance": 2.5, // growing export surplus (Wirtschaftswunder)
  "economic.productivityGrowth": 7.5, // extraordinary reconstruction growth
  "economic.rdIntensity": 0.5, // war destroyed R&D; rebuilding slowly
  "economic.propertyValueIndex": 20, // rubble cities; construction underway
  "economic.commercialValueIndex": 25,
  "economic.ruralRevitalization": 62, // large agrarian sector still
  "economic.foodSecurity": 60, // food rationing only just ended (1950)
  "economic.exportDependency": 20, // growing; GATT/ECA
  "economic.manufacturingCompetitiveness": 72, // rebuilding fast (Ruhr/Rhine)
  "economic.regulatoryBurden": 45, // Ordoliberal light-touch
  "economic.economicFreedom": 62, // social market economy
  "education.highSchoolGradRate": 60, // gymnasium system intact; Abitur rate low
  "education.universityEnrollment": 6, // war depleted universities
  "education.apprenticeshipRate": 6.0, // dual system strong
  "education.academicPressure": 55,
  "healthcare.uninsuredRate": 10, // statutory health insurance (GKV) from 1883 — coverage broad
  "healthcare.nhsWaitingTime": 7, // weeks; Bismarckian sickness funds intact and the hospital network rebuilt fast under the ERP
  "healthcare.affordabilityIndex": 70,
  "healthcare.mentalHealthAccess": 20,
  "healthcare.socialCareQuality": 35,
  "healthcare.elderCareQuality": 35,
  "infrastructure.transportEfficiency": 45, // Autobahn rebuilt; rail disrupted by partition
  "infrastructure.roadCondition": 55, // Autobahn network but heavy bomb damage
  "environment.protectedLand": 1.8, // % of land; Naturschutz tradition, little land actually reserved
  "infrastructure.powerGridReliability": 96, // % uptime; grid and mains rebuilt fast under the ERP
  "infrastructure.waterQuality": 84, // treated-supply index
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "publicSafety.antiSocialBehaviourRate": 6,
  "publicSafety.knifeCrimeRate": 2,
  "environment.floodRisk": 12,
  "environment.naturalDisasterPreparedness": 45,
  "environment.nuclearSafety": 0, // no nuclear plants yet
  "environment.energyTransitionProgress": 0, // Ruhr coal economy
  "social.childPoverty": 28, // Wirtschaftswunder not yet lifting all boats
  "social.housingAffordability": 20, // severe housing shortage (bombing + expellees)
  "social.roughSleeping": 8, // many displaced persons and refugees
  "social.workLifeBalance": 50,
  "social.foreignWorkerIntegration": 25, // Gastarbeiter programme not until 1955
  "social.genderEquality": 20, // Grundgesetz equality article (Art. 3) but not yet enforced
  "social.housingSupplyGrowth": 5.0, // massive building programme
  "governance.debtToGdp": 8, // London Debt Agreement 1953 — BRD external debt forgiven
  "governance.devolutionSatisfaction": 58, // Föderalismus; Länder strong
  "governance.roboticsAdoption": 0,
  "governance.coDeterminationQuality": 45, // Mitbestimmungsgesetz 1951 (coal/steel only)
  "governance.nationalPride": 50, // shame of Nazi era + pride in recovery
  "governance.civilLiberties": 68, // Grundgesetz; but KPD banned (1956); press free
  "governance.militaryReadiness": 15, // no army yet; rearmament being debated
  "population.demographicDecline": 10, // baby boom; expellee integration
  "mediaInformation.stateMediaControl": 30, // ARD public broadcasting dominant

  // #income-gdp-scale-audit / birthRate-audit: this overlay previously had NO
  // "population." category at all, so DE's modern deStateMetrics.ts values
  // (medianAge ~44-48, no birthRate field) fed straight into
  // applyEra1953Adjustments (seedDE.ts), whose shift-based pass-through pulls
  // an unauthored birthRate toward ~49-51 — a 2019-replacement-level TFR
  // silently imposed on a 1950s baby-boom country. Statistisches Bundesamt /
  // UN Demographic Yearbook 1950-55: West Germany's real 1953 TFR ≈2.1 and
  // median age ≈35 (war losses thinned the male mid-cohort but the
  // population was not especially young). birthRateIndexToTFR(52, 2.06) =
  // 2.06*(0.4+0.52*1.2) = 2.13.
  "population.medianAge": 35,
  "population.birthRate": 52,
  "population.urbanizationRate": 70, // Destatis 1950 — West Germany already densely urban/industrial
};

/** West Germany zones only — BB/MV/SN/ST/TH were DDR in 1953; use national baseline for those */
const TILTS_1953: Record<string, Record<string, number>> = {
  NW: {
    "economic.manufacturingCompetitiveness": 82, // Ruhr industrial heartland
    "economic.exportDependency": 28,
    "economic.rdIntensity": 0.6,
    "social.housingAffordability": 22,
  },
  HH: {
    "economic.exportDependency": 45, // Hamburg port
    "economic.tradeBalance": 5.0,
    "economic.manufacturingCompetitiveness": 78,
    "infrastructure.transportEfficiency": 60,
    "social.housingAffordability": 18,
  },
  BE: {
    "governance.civilLiberties": 72,
    "social.housingAffordability": 16,
    "governance.nationalPride": 55,
  },
  BY: {
    "economic.ruralRevitalization": 72,
    "economic.manufacturingCompetitiveness": 70,
    "economic.rdIntensity": 0.6,
    "governance.nationalPride": 52,
  },
  BW: {
    "economic.manufacturingCompetitiveness": 80,
    "economic.rdIntensity": 0.7,
    "economic.exportDependency": 28,
  },
  SL: {
    "economic.manufacturingCompetitiveness": 80, // Saarland — steel; returned to BRD 1957
    "economic.ruralRevitalization": 55,
  },
};

export const deMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  DE_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
