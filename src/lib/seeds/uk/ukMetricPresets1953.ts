import type { MetricPresetBundle } from "@/lib/seeds/uk/ukMetricPresets";

/**
 * 1953 UK — Churchill's final term (resigned April 1955). Post-WWII austerity ending;
 * NHS 5 years old but severely underfunded; Korean War rearmament (defense ~9% GDP);
 * rationing still in force (ended 1954); National Coal Board, British Railways, BT all
 * nationalised. No North Sea oil, no broadband, no motorways (M1 opened 1959), no nuclear
 * power (first UK plant Calder Hall opened 1956). Empire at peak but decolonisation beginning.
 * BBC dominant; no commercial television until 1955. Deep manufacturing base (Midlands/North).
 * UK public debt ~175% of GDP (WWII bonds still outstanding).
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

const NATIONAL_1953: Record<string, number> = {
  "economic.laborParticipation": 55, // women largely out of formal workforce
  "economic.matchingFriction": 3.5, // labour allocation less fluid
  "economic.tradeBalance": 0.5, // rough balance — Commonwealth trade preference
  "economic.productivityGrowth": 2.8, // post-war reconstruction productivity surge
  "economic.rdIntensity": 0.8, // defence R&D secret; civilian minimal
  // #income-gdp-scale-audit: was UNAUTHORED here, so seedUKStateMetrics fell
  // through to INCOME_ANCHORS.UK[1953] = 4,300 (metricCatalog.ts), a figure
  // that was itself derived as `1979 nominal (11,000) × Maddison REAL
  // GDP/capita 1953:1979 ratio` — a real-volume ratio applied to a nominal
  // value. Against the 1953 budget's GDP/capita (£14.4B / 50.6M ≈ £284.6;
  // NATIONAL_BUDGET_SEED_CONFIGS_1953 "UK"), 4,300 implied a ratio of ~15.1×
  // — an order of magnitude over medianIncomeGdpScale1953.test.ts's [0.8,
  // 2.6] band. Real grounding: 1953 average weekly earnings for adult male
  // manual workers were ~£8-9 (Ministry of Labour Gazette), i.e. ~£420-470/yr
  // per earner; a household median sits somewhat above a single manual
  // wage. 450 gives ratio 450/284.6 ≈ 1.58×, next to the US 1953 reference
  // point (1.59×: Census $3,900 median family income / $2,449 GDP/capita).
  // INCOME_ANCHORS.UK[1953] in metricCatalog.ts re-anchored to match (see
  // that file).
  "economic.medianIncome": 450,
  "economic.propertyValueIndex": 30, // 1953 UK property very cheap vs income
  "economic.commercialValueIndex": 28,
  "economic.ruralRevitalization": 55, // still significant agricultural sector
  "economic.foodSecurity": 65, // rationing ending — food still restricted
  "economic.exportDependency": 25, // Commonwealth preference, less integrated
  "economic.manufacturingCompetitiveness": 80, // peak UK manufacturing (coal/steel/shipbuilding)
  "economic.regulatoryBurden": 52, // nationalised industries, heavy regulation
  "economic.economicFreedom": 55, // mixed economy, nationalised sector large
  "education.highSchoolGradRate": 35, // most left school at 15; no O-levels until 1951
  "education.universityEnrollment": 4, // elite university (Oxbridge + redbricks only)
  "education.apprenticeshipRate": 4.0, // traditional trade apprenticeships common
  "education.academicPressure": 35,
  "healthcare.uninsuredRate": 2, // NHS universal coverage (1948)
  "healthcare.affordabilityIndex": 80, // NHS free at point of use
  "healthcare.mentalHealthAccess": 15, // asylums only; no community mental health
  "healthcare.socialCareQuality": 30, // very limited social care
  "healthcare.elderCareQuality": 30,
  "infrastructure.transportEfficiency": 50, // rail good; no motorways; roads adequate
  "publicSafety.antiSocialBehaviourRate": 3,
  "publicSafety.knifeCrimeRate": 1,
  "environment.floodRisk": 18, // 1953 North Sea floods (catastrophic Jan 1953)
  "environment.naturalDisasterPreparedness": 40, // poor (1953 flood exposed gaps)
  "environment.nuclearSafety": 0, // no commercial nuclear yet
  "environment.energyTransitionProgress": 0, // coal economy
  "social.childPoverty": 25, // significant — means-tested welfare minimal
  "social.housingAffordability": 8, // housing cheap (price-to-income ratio convention)
  "social.roughSleeping": 4,
  "social.workLifeBalance": 48, // 48-hour working week common
  "social.foreignWorkerIntegration": 35, // Commonwealth immigration just beginning (Windrush 1948)
  "social.genderEquality": 22, // women expected to leave work on marriage
  "social.housingSupplyGrowth": 3.5, // council housing boom under Macmillan (300k/yr target)
  "governance.debtToGdp": 175, // massive WWII debt
  "governance.devolutionSatisfaction": 45, // no devolution at all
  "governance.roboticsAdoption": 0,
  "governance.nationalPride": 80, // Empire, WWII victory, coronation 1953
  "governance.civilLiberties": 65, // press free; Official Secrets; sodomy laws
  "governance.militaryReadiness": 80, // Korean War, large conscript army (National Service)
  // #birth-rate-coverage-audit: was UNAUTHORED here, so the field fell through
  // to seedCohortVectors' DEFAULT_BIRTH_RATE = 50 (a 2019-replacement-level
  // TFR of 2.06) unless applyEra1953Adjustments' own +8 pass-through nudged
  // the modern uniformStateMetrics-derived value (65 − medianAge×0.5) instead
  // — either way, an ACCIDENT of the chain rather than an authored figure.
  // 0-100 fertility INDEX (birthRateIndexToTFR: TFR = 2.06 × (0.4 + idx/100 ×
  // 1.2), so idx 50 ⇒ TFR 2.06). Real UK 1953 TFR ≈ 2.2 (ONS historical
  // births series / Registrar General's Statistical Review) ⇒ idx ≈ 56.
  // Regional variation is real: higher in the industrial North / Wales /
  // Scotland, lower in London and the South East commuter belt — see
  // per-region overrides below.
  "population.birthRate": 56,
  "population.demographicDecline": 12, // baby boom underway
  "mediaInformation.bbcTrust": 75, // BBC near-monopoly; very high trust
  "mediaInformation.stateMediaControl": 20, // BBC public but editorially independent
};

const TILTS_1953: Record<string, Record<string, number>> = {
  LON: {
    "economic.propertyValueIndex": 40,
    "economic.commercialValueIndex": 45,
    "economic.manufacturingCompetitiveness": 65, // London less industrial
    "economic.exportDependency": 35,
    // Highest income share by the ukRegionCensusData1953 income tiers is
    // actually SEE (high 24% / low 22%) with LON second (high 18% / low
    // 30%) — a large City/professional class alongside dockland/East End
    // poverty. 520 sits ~15% above the 450 national default.
    "economic.medianIncome": 520,
    // Large single/childless professional population + war-disrupted
    // households keep fertility below the national mean, as in most large
    // 1950s capitals (ONS Registrar General's regional birth tables).
    "population.birthRate": 50,
    "education.universityEnrollment": 7,
    "infrastructure.transportEfficiency": 65, // Underground, trams
    "social.foreignWorkerIntegration": 50,
    "social.housingAffordability": 6,
    "social.childPoverty": 20,
    "governance.nationalPride": 82,
  },
  SEE: {
    // Home Counties / commuter belt — Churchill country; ukRegionCensusData1953
    // gives SEE the UK's lowest "low" income share (22%) and highest "high"
    // share (24%), so this is the richest region on that same tier table.
    "economic.medianIncome": 550,
    // Commuter-belt professional households — below-average fertility,
    // matching the low-income-tier / high-income-tier profile above.
    "population.birthRate": 50,
  },
  EMI: {
    // Mixed farming shires + Leicester/Nottingham light industry — a swing
    // region sitting close to the national income median (tier table:
    // low 30% / high 15%, near the national mix).
    "economic.medianIncome": 440,
    // Matches the national default; authored explicitly (rather than left to
    // fall through) so the region's overlay entry documents intent.
    "population.birthRate": 56,
  },
  WMI: {
    "economic.manufacturingCompetitiveness": 85, // Birmingham / Black Country
    "economic.laborParticipation": 58,
    // Car/metal trades mid-boom; tier table middling (low 30% / high 15%,
    // same as EMI) but wage-driven rather than farm-income-driven.
    "economic.medianIncome": 435,
    // Industrial Midlands — higher fertility than the London/SE service belt.
    "population.birthRate": 62,
  },
  YHU: {
    "economic.manufacturingCompetitiveness": 85, // Yorkshire steel/textiles
    "social.childPoverty": 28,
    // Steel/textile wages below the Midlands car trades; tier table shows
    // YHU's low share (38%) well above EMI/WMI's (30%).
    "economic.medianIncome": 400,
    "population.birthRate": 60, // industrial North — above national mean
  },
  NWE: {
    "economic.manufacturingCompetitiveness": 82, // Manchester / Lancashire / Merseyside
    "social.childPoverty": 27,
    "economic.medianIncome": 395, // same income tier as YHU (low 38% / high 11%)
    // Manchester/Lancashire/Merseyside industrial belt, large Catholic
    // Liverpool population — among the highest English fertility.
    "population.birthRate": 62,
  },
  NEE: {
    "economic.manufacturingCompetitiveness": 78,
    "social.childPoverty": 30,
    "governance.nationalPride": 78,
    // Poorest English region on the tier table (low 44% / high 8%) —
    // shipbuilding/coal wages without the West Midlands' car-trade premium.
    "economic.medianIncome": 365,
    "population.birthRate": 64, // highest English fertility — coal/shipbuilding communities
  },
  SCO: {
    "economic.manufacturingCompetitiveness": 80, // Clyde shipbuilding
    "social.childPoverty": 28,
    "governance.devolutionSatisfaction": 50,
    "mediaInformation.bbcTrust": 72,
    "environment.floodRisk": 10, // different flood exposure
    // Tier table: low 40% / high 11% — poorer than England's Midlands/South,
    // richer than Wales/NI (Clydeside heavy industry keeps it off the floor).
    "economic.medianIncome": 410,
    "population.birthRate": 62, // Clydeside + rural Highlands — above-replacement
  },
  WAL: {
    "economic.manufacturingCompetitiveness": 78, // coal mining
    "social.childPoverty": 30,
    "governance.devolutionSatisfaction": 48,
    "environment.floodRisk": 8,
    // South Wales valleys coal-mining economy; tier table low 42% / high 9%.
    "economic.medianIncome": 375,
    "population.birthRate": 60, // valleys mining communities — above national mean
  },
  NIR: {
    "governance.civilLiberties": 52, // sectarian discrimination
    "governance.devolutionSatisfaction": 42,
    "social.foreignWorkerIntegration": 25,
    "social.childPoverty": 28,
    "mediaInformation.bbcTrust": 68,
    "environment.floodRisk": 8,
    // Poorest UK nation on the tier table (low 42% / high 10%, close to Wales)
    // but treated as slightly ahead of Wales, consistent with Belfast's
    // shipbuilding/linen wage floor.
    "economic.medianIncome": 385,
    // Pre-Troubles NI: both Catholic and Protestant communities ran well
    // above the rest-of-UK TFR (Registrar General NI annual reports) — the
    // highest 1953 fertility of any UK region, well above the England/
    // Scotland/Wales industrial belt.
    "population.birthRate": 80,
  },
  SWE: {
    "economic.ruralRevitalization": 65,
    "economic.foodSecurity": 72,
    "social.childPoverty": 22,
    // Rural shires/fishing towns, little heavy industry; tier table low 28% /
    // high 17% — a notch below SEE/EAE/LON but ahead of the industrial North.
    "economic.medianIncome": 470,
    "population.birthRate": 54, // rural — modestly above national mean
  },
  EAE: {
    "economic.ruralRevitalization": 68,
    "economic.foodSecurity": 75,
    // East Anglian farming + early Cambridge/Norwich towns; tier table low
    // 25% / high 20% — the second-richest region behind SEE.
    "economic.medianIncome": 500,
    "population.birthRate": 54, // rural farming counties — modestly above national mean
  },
};

export const ukMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  UK_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
