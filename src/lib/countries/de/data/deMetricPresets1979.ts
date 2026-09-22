import type { MetricPresetBundle } from "@/lib/seeds/de/deMetricPresets";

/**
 * 1979 West Germany — Helmut Schmidt (SPD-FDP coalition). "Modell Deutschland" at its apex;
 * post-oil-shock adjustment complete (low inflation ~4.1% vs France/UK/US stagflation);
 * unemployment low (3.4%) but starting to rise; Deutsche Mark the reserve anchor of the EMS
 * (European Monetary System founded 1979). Manufacturing at peak export performance. Bundeswehr
 * ~495,000 troops; NATO Eastern pillar. Nuclear power active (Biblis, Brunsbüttel, Isar I).
 * Codetermination Act 1976 extended to all large companies. No broadband. Ostpolitik ongoing.
 * Public debt ~26% GDP — lowest in the G7.
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
  "TH",
] as const;

const NATIONAL_1979: Record<string, number> = {
  "economic.laborParticipation": 62, // growing female participation; Gastarbeiter included
  "economic.matchingFriction": 3.5, // unemployment 3.4%; tighter than early 1980s
  "economic.tradeBalance": 3.5, // large current-account surplus (DM undervalued)
  "economic.productivityGrowth": 2.5, // slower than 1953 but steady
  "economic.rdIntensity": 2.1, // strong industrial R&D (chemical/auto/engineering)
  "economic.propertyValueIndex": 45, // moderate; Germans rent more than own
  "economic.commercialValueIndex": 50,
  "economic.ruralRevitalization": 42, // rural but mainly agri-tourism; industry suburbanised
  "economic.foodSecurity": 75, // self-sufficient in most staples; CAP member
  "economic.exportDependency": 28, // highly export-dependent (Exportweltmeister)
  "economic.manufacturingCompetitiveness": 88, // peak West German industry: VW/BMW/Bayer/BASF/MAN
  "economic.regulatoryBurden": 48, // Ordoliberal; strong DGB co-determination rules
  "economic.economicFreedom": 65, // social market economy at zenith
  "education.highSchoolGradRate": 72, // Abitur rate growing; dual system strong
  "education.universityEnrollment": 16,
  "education.apprenticeshipRate": 6.5, // peak dual apprenticeship system
  "education.academicPressure": 60,
  "healthcare.uninsuredRate": 8, // GKV statutory insurance broadly covering; some gaps
  "healthcare.affordabilityIndex": 78,
  "healthcare.mentalHealthAccess": 30, // community psychiatry developing
  "healthcare.socialCareQuality": 55,
  "healthcare.elderCareQuality": 55,
  "infrastructure.transportEfficiency": 68, // Autobahn extended; DB rail reliable; Rhine barge
  "publicSafety.antiSocialBehaviourRate": 4,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 14,
  "environment.naturalDisasterPreparedness": 62,
  "environment.nuclearSafety": 65, // multiple nuclear plants operating; Wyhl protests
  "environment.energyTransitionProgress": 3, // coal dominant; early wind debate (Grüne forming 1980)
  "social.childPoverty": 10, // social market + family benefits
  "social.housingAffordability": 22, // rentals stable; Mietrecht tenant-protective
  "social.roughSleeping": 2,
  "social.workLifeBalance": 60, // 40-hr week; IG Metall pushing 35-hr (achieved 1984)
  "social.foreignWorkerIntegration": 38, // Gastarbeiter (~2M Turks) nominally "temporary"
  "social.genderEquality": 45, // § 218 (abortion) reformed 1976; women working more
  "social.housingSupplyGrowth": 1.5, // construction slowing post-Wirtschaftswunder
  "governance.debtToGdp": 26, // Modell Deutschland fiscal discipline
  "governance.devolutionSatisfaction": 68, // Föderalismus strong; Länder autonomous
  "governance.roboticsAdoption": 2, // early automotive robots (KUKA) — very nascent
  "governance.coDeterminationQuality": 72, // Mitbestimmungsgesetz 1976 extended to 2000+ employees
  "governance.nationalPride": 62, // pride in Wirtschaftswunder; Vergangenheitsbewältigung
  "governance.civilLiberties": 75, // Grundgesetz strong; Berufsverbot chill (1972) fading
  "governance.militaryReadiness": 72, // Bundeswehr ~495k; NATO Article 5 pillar
  "population.demographicDecline": 38, // birth rate below replacement; Gastarbeiter offsetting
  "mediaInformation.stateMediaControl": 28, // ARD/ZDF public; commercial TV not until 1984
};

const TILTS_1979: Record<string, Record<string, number>> = {
  NW: {
    "economic.manufacturingCompetitiveness": 92, // Ruhr — steel/chemicals/coal; still at peak
    "economic.exportDependency": 35,
    "economic.rdIntensity": 2.3,
    "social.childPoverty": 12,
    "social.foreignWorkerIntegration": 45, // large Turkish community in Ruhr
  },
  HH: {
    "economic.exportDependency": 55, // Hamburg port — largest EU container port
    "economic.tradeBalance": 7.0,
    "economic.manufacturingCompetitiveness": 85,
    "infrastructure.transportEfficiency": 75,
    "social.foreignWorkerIntegration": 45,
    "governance.civilLiberties": 78,
  },
  BE: {
    "governance.civilLiberties": 80, // West Berlin — liberal island; Kreuzberg scene
    "social.foreignWorkerIntegration": 48, // large Turkish community (Kreuzberg)
    "governance.nationalPride": 58, // divided city; Ostpolitik backdrop
    "economic.propertyValueIndex": 38,
    "infrastructure.transportEfficiency": 70,
  },
  BY: {
    "economic.ruralRevitalization": 52,
    "economic.manufacturingCompetitiveness": 88, // BMW/MAN/Siemens
    "economic.rdIntensity": 2.5,
    "governance.nationalPride": 65,
    "governance.devolutionSatisfaction": 72, // Bavarian CSU autonomy pride
  },
  BW: {
    "economic.manufacturingCompetitiveness": 92, // Daimler-Benz/Porsche/Bosch/Zeiss
    "economic.rdIntensity": 2.8,
    "economic.exportDependency": 35,
    "social.genderEquality": 48,
  },
  SL: {
    "economic.manufacturingCompetitiveness": 82, // Saarland steel; declining (French competition)
    "social.childPoverty": 14,
  },
  HE: {
    "economic.propertyValueIndex": 50,
    "economic.rdIntensity": 2.2,
    "infrastructure.transportEfficiency": 72, // Frankfurt airport hub
    "social.foreignWorkerIntegration": 42,
  },
  // East German Länder — NOT part of BRD in 1979; use national baseline as placeholder
  BB: { "governance.nationalPride": 55 },
  MV: { "governance.nationalPride": 55 },
  SN: { "economic.manufacturingCompetitiveness": 80 }, // Saxony — east placeholder
  ST: { "governance.nationalPride": 55 },
  TH: { "governance.nationalPride": 55 },
};

export const deMetricPresets1979: MetricPresetBundle = Object.fromEntries(
  DE_REGIONS.map((region) => [region, { ...NATIONAL_1979, ...(TILTS_1979[region] ?? {}) }])
);
